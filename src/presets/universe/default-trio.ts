// ── Universe Preset: Default Trio ─────────────────────────────────────────────
// Sun + Planet + Perturber の標準3体構成。アプリ起動時のデフォルト。

import type { UniversePreset } from '../types'
import { DEFAULT_BODIES, DEFAULT_SIM_PARAMS } from '../../store/planetStore'

export const defaultTrio: UniversePreset = {
  id:          'universe-default-trio',
  name:        'Default Trio',
  description: 'Sun + Planet + Perturber の標準3体構成',
  icon:        '⊙',
  bodies:    [...DEFAULT_BODIES],
  simParams: { ...DEFAULT_SIM_PARAMS },
}
