export type ExpressionScope = Record<string, number>

type Token =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'leftParen' | 'rightParen' | 'comma' | 'eof' }

const constants: ExpressionScope = {
  pi: Math.PI,
  e: Math.E,
}

const functions: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sqrt: Math.sqrt,
  clamp: (value, min, max) => Math.min(Math.max(value, min), max),
  map: (value, inMin, inMax, outMin, outMax) => {
    if (inMax === inMin) return outMin
    return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin)
  },
  random: (...args) => args.length === 0 ? Math.random() : seededRandom(args[0]),
  noise: (value, seed = 0) => valueNoise(value, seed),
}

export function evaluateExpression(source: string, scope: ExpressionScope = {}): number {
  const parser = new ExpressionParser(tokenize(source), scope)
  const value = parser.parse()
  if (!Number.isFinite(value)) throw new Error('Expression produced a non-finite value')
  return value
}

export function validateExpression(source: string): string | null {
  try {
    evaluateExpression(source, {
      distance: 0,
      angle: 0,
      speed: 0,
      seed: 0,
      x: 0,
      y: 0,
      z: 0,
      t: 0,
      time: 0,
      frame: 0,
    })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid expression'
  }
}

class ExpressionParser {
  private index = 0
  private readonly tokens: Token[]
  private readonly scope: ExpressionScope

  constructor(tokens: Token[], scope: ExpressionScope) {
    this.tokens = tokens
    this.scope = scope
  }

  parse(): number {
    const value = this.parseAdditive()
    if (this.peek().type !== 'eof') throw new Error('Unexpected token')
    return value
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative()
    while (this.matchOperator('+') || this.matchOperator('-')) {
      const operator = (this.previous() as Extract<Token, { type: 'operator' }>).value
      const right = this.parseMultiplicative()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }

  private parseMultiplicative(): number {
    let value = this.parsePower()
    while (this.matchOperator('*') || this.matchOperator('/') || this.matchOperator('%')) {
      const operator = (this.previous() as Extract<Token, { type: 'operator' }>).value
      const right = this.parsePower()
      if (operator === '*') value *= right
      else if (operator === '/') value /= right
      else value %= right
    }
    return value
  }

  private parsePower(): number {
    const value = this.parseUnary()
    if (!this.matchOperator('^')) return value
    return value ** this.parsePower()
  }

  private parseUnary(): number {
    if (this.matchOperator('+')) return this.parseUnary()
    if (this.matchOperator('-')) return -this.parseUnary()
    return this.parsePrimary()
  }

  private parsePrimary(): number {
    const token = this.advance()
    if (token.type === 'number') return token.value

    if (token.type === 'identifier') {
      if (this.match('leftParen')) {
        const args: number[] = []
        if (this.peek().type !== 'rightParen') {
          do {
            args.push(this.parseAdditive())
          } while (this.match('comma'))
        }
        this.consume('rightParen', 'Missing closing parenthesis')
        const fn = functions[token.value]
        if (!fn) throw new Error(`Unknown function: ${token.value}`)
        return fn(...args)
      }
      const value = this.scope[token.value] ?? constants[token.value]
      if (value === undefined) throw new Error(`Unknown variable: ${token.value}`)
      return value
    }

    if (token.type === 'leftParen') {
      const value = this.parseAdditive()
      this.consume('rightParen', 'Missing closing parenthesis')
      return value
    }

    throw new Error('Expected a number, variable, or function')
  }

  private match(type: Token['type']): boolean {
    if (this.peek().type !== type) return false
    this.index += 1
    return true
  }

  private matchOperator(operator: string): boolean {
    const token = this.peek()
    if (token.type !== 'operator' || token.value !== operator) return false
    this.index += 1
    return true
  }

  private consume(type: Token['type'], message: string): void {
    if (!this.match(type)) throw new Error(message)
  }

  private advance(): Token {
    const token = this.peek()
    this.index += 1
    return token
  }

  private peek(): Token {
    return this.tokens[this.index]
  }

  private previous(): Token {
    return this.tokens[this.index - 1]
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < source.length) {
    const char = source[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (/[0-9.]/.test(char)) {
      const match = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)
      if (!match) throw new Error(`Invalid number at position ${index + 1}`)
      tokens.push({ type: 'number', value: Number(match[0]) })
      index += match[0].length
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)
      if (!match) throw new Error(`Invalid identifier at position ${index + 1}`)
      tokens.push({ type: 'identifier', value: match[0].toLowerCase() })
      index += match[0].length
      continue
    }
    if ('+-*/%^'.includes(char)) tokens.push({ type: 'operator', value: char })
    else if (char === '(') tokens.push({ type: 'leftParen' })
    else if (char === ')') tokens.push({ type: 'rightParen' })
    else if (char === ',') tokens.push({ type: 'comma' })
    else throw new Error(`Unsupported character: ${char}`)
    index += 1
  }

  tokens.push({ type: 'eof' })
  return tokens
}

function seededRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

function valueNoise(value: number, seed: number): number {
  const start = Math.floor(value)
  const fraction = value - start
  const smooth = fraction * fraction * (3 - 2 * fraction)
  const a = seededRandom(start + seed * 1013)
  const b = seededRandom(start + 1 + seed * 1013)
  return a + (b - a) * smooth
}
