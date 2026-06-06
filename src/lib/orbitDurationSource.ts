export type OrbitDurationBody = {
  id: string
  name: string
}

export const ORBIT_HUB_DEFINITIONS = {
  T: {
    symbol: 'T',
    label: 'body T-period',
    description: 'The orbital period of the referenced body, expressed in seconds.',
  },
} as const

export const ORBIT_HUB_VALUE_DEFINITIONS = [
  { symbol: 'T', label: 'body T-period', unit: 's', description: 'Referenced body orbital period in real seconds.' },
  { symbol: 'r', label: 'orbital distance', unit: 'world', description: 'Distance from the body to its current orbit center.' },
  { symbol: 'v', label: 'body speed', unit: 'world/sim', description: 'Magnitude of the body velocity vector.' },
  { symbol: 'a', label: 'body acceleration', unit: 'world/sim²', description: 'Magnitude of the body acceleration vector.' },
  { symbol: 'e / ecc / ε', label: 'eccentricity', unit: 'ratio', description: 'Estimated eccentricity: 0 is circular and 1 is parabolic.' },
  { symbol: 'm', label: 'body mass', unit: 'mass', description: 'Mass assigned to the referenced body.' },
  { symbol: 'ω', label: 'angular velocity', unit: 'rad/sim', description: 'Instantaneous angular velocity around the current orbit center.' },
  { symbol: 'φ', label: 'orbit phase', unit: '0–1 / deg', description: 'Current fractional orbit phase or its angle representation.' },
  { symbol: 'B / bound', label: 'bound state', unit: '0 / 1', description: '1 for a gravitationally bound orbit; otherwise 0.' },
] as const

export const ORBIT_HUB_FORMULA_DEFINITIONS = [
  { syntax: 'T', result: 'current body T-period' },
  { syntax: 'T/4', result: 'quarter of body T-period' },
  { syntax: 'T*2', result: 'two body T-periods' },
  { syntax: 'Sun.T/8', result: 'one eighth of Sun T-period' },
  { syntax: '(T/4)*3', result: 'three quarters of body T-period' },
  { syntax: 'current.T', result: 'current body T-period' },
  { syntax: 'body("name").T', result: 'named body T-period' },
] as const

export const ORBIT_HUB_T_CALCULATION = [
  'Center = the heaviest other body',
  'μ = G × (center mass + body mass)',
  'E = v²/2 − μ/r',
  'Bound: A = −μ/(2E), Tsim = 2π√(A³/μ)',
  'T = clamp(Tsim/48, 0.3s, 25s)',
  'Unbound: estimate T from current r and v',
] as const

export const ORBIT_HUB_TPERIOD_NOTE =
  'T-period trigger uses measured wall-clock orbit duration when available; otherwise it uses the smoothed angular period.'

export const ORBIT_T_DEFINITION = `${ORBIT_HUB_DEFINITIONS.T.symbol} = ${ORBIT_HUB_DEFINITIONS.T.label}`

export type OrbitDurationSourceResult<T extends OrbitDurationBody> = {
  body: T
  expression: string
  label: string
  multiplier: number
  error: string | null
}

function evaluateScalarExpression(expression: string): number {
  let index = 0

  const skipSpaces = () => {
    while (/\s/.test(expression[index] ?? '')) index += 1
  }
  const parseFactor = (): number => {
    skipSpaces()
    if (expression[index] === '(') {
      index += 1
      const value = parseProduct()
      skipSpaces()
      if (expression[index] !== ')') throw new Error('Missing closing parenthesis')
      index += 1
      return value
    }
    const match = expression.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/)
    if (!match) throw new Error('Expected a number or T')
    index += match[0].length
    return Number(match[0])
  }
  const parseProduct = (): number => {
    let value = parseFactor()
    while (true) {
      skipSpaces()
      const operator = expression[index]
      if (operator !== '*' && operator !== '/') break
      index += 1
      const right = parseFactor()
      if (operator === '/' && right === 0) throw new Error('Division by zero')
      value = operator === '*' ? value * right : value / right
    }
    return value
  }

  const value = parseProduct()
  skipSpaces()
  if (index !== expression.length) throw new Error('Only *, /, and parentheses are supported')
  if (!Number.isFinite(value) || value <= 0) throw new Error('Duration multiplier must be greater than zero')
  return value
}

export function resolveOrbitDurationSource<T extends OrbitDurationBody>(
  expression: string,
  currentBody: T,
  bodies: T[],
): OrbitDurationSourceResult<T> {
  const source = expression.trim() || 'T'
  let target = currentBody
  let durationStart = -1
  let durationLength = 0

  const bodyCall = source.match(/body\(([^)]+)\)\.T/i)
  if (bodyCall?.index !== undefined) {
    const selector = bodyCall[1].trim().replace(/^["']|["']$/g, '')
    const key = selector.toLocaleLowerCase()
    const found = bodies.find(body =>
      body.id.toLocaleLowerCase() === key ||
      body.name.toLocaleLowerCase() === key
    )
    if (!found) {
      return {
        body: currentBody,
        expression: source,
        label: `${currentBody.name}.T`,
        multiplier: 1,
        error: `Body "${selector}" was not found`,
      }
    }
    target = found
    durationStart = bodyCall.index
    durationLength = bodyCall[0].length
  } else {
    const references = bodies
      .flatMap(body => [
        { text: `${body.id}.T`, body },
        { text: `${body.name}.T`, body },
      ])
      .sort((a, b) => b.text.length - a.text.length)
    const lowerSource = source.toLocaleLowerCase()
    const reference = references.find(candidate => lowerSource.includes(candidate.text.toLocaleLowerCase()))
    if (reference) {
      target = reference.body
      durationStart = lowerSource.indexOf(reference.text.toLocaleLowerCase())
      durationLength = reference.text.length
    } else {
      const currentMatch = source.match(/current\.T/i)
      const tMatch = source.match(/(^|[\s(*/])T(?=$|[\s)*/])/i)
      if (currentMatch?.index !== undefined) {
        durationStart = currentMatch.index
        durationLength = currentMatch[0].length
      } else if (tMatch?.index !== undefined) {
        durationStart = tMatch.index + tMatch[1].length
        durationLength = 1
      }
    }
  }

  if (durationStart < 0) {
    return {
      body: currentBody,
      expression: source,
      label: `${currentBody.name}.T`,
      multiplier: 1,
      error: 'Use T, T/4, bodyId.T, or bodyName.T',
    }
  }

  const scalarExpression =
    source.slice(0, durationStart) +
    '1' +
    source.slice(durationStart + durationLength)

  try {
    const multiplier = evaluateScalarExpression(scalarExpression)
    const multiplierLabel = Math.abs(multiplier - 1) < 1e-9 ? '' : ` × ${Number(multiplier.toFixed(6))}`
    return {
      body: target,
      expression: source,
      label: `${target.name}.T${multiplierLabel}`,
      multiplier,
      error: null,
    }
  } catch (error) {
    return {
      body: currentBody,
      expression: source,
      label: `${currentBody.name}.T`,
      multiplier: 1,
      error: error instanceof Error ? error.message : 'Invalid duration expression',
    }
  }
}
