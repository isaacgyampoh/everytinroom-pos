import { describe, it, expect } from 'vitest'
import { parseVersion, compareVersions, isNewerVersion } from './version'

describe('parseVersion', () => {
  it('reads the three numbers', () => {
    expect(parseVersion('2.10.3')).toEqual([2, 10, 3])
  })

  it('tolerates a v prefix and a pre-release suffix', () => {
    expect(parseVersion('v2.1.0')).toEqual([2, 1, 0])
    expect(parseVersion('2.1.0-beta.4')).toEqual([2, 1, 0])
  })

  it('turns rubbish into zero rather than NaN', () => {
    expect(parseVersion('2.x.1')).toEqual([2, 0, 1])
    expect(parseVersion('')).toEqual([0])
    expect(parseVersion(null)).toEqual([0])
  })
})

describe('compareVersions', () => {
  // The whole reason this file exists. As text, '2.10.0' < '2.9.0', so a shop
  // on 2.9.0 would be told it was current for the entire 2.10 series.
  it('compares numerically, not as text', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1)
    expect(compareVersions('2.9.0', '2.10.0')).toBe(-1)
    expect(compareVersions('2.2.10', '2.2.9')).toBe(1)
  })

  it('is zero for the same version however it is written', () => {
    expect(compareVersions('2.1.0', 'v2.1.0')).toBe(0)
    expect(compareVersions('2.1.0', '2.1.0-rc1')).toBe(0)
  })

  it('treats a missing segment as zero', () => {
    expect(compareVersions('2.1', '2.1.0')).toBe(0)
    expect(compareVersions('2.1.1', '2.1')).toBe(1)
  })
})

describe('isNewerVersion', () => {
  it('prompts only for a genuinely higher version', () => {
    expect(isNewerVersion('2.2.0', '2.1.0')).toBe(true)
    expect(isNewerVersion('2.10.0', '2.9.0')).toBe(true)
  })

  it('does not nag a till running the current build', () => {
    expect(isNewerVersion('2.1.0', '2.1.0')).toBe(false)
  })

  // If somebody republishes an older installer by mistake, a shop must not be
  // walked backwards onto it.
  it('never pushes a till backwards', () => {
    expect(isNewerVersion('2.0.0', '2.1.0')).toBe(false)
  })

  // Quiet is the safe failure: a missed prompt costs a late update, a false one
  // costs a shop reinstalling its till for nothing.
  it('stays quiet when either version is missing or unreadable', () => {
    expect(isNewerVersion(null, '2.1.0')).toBe(false)
    expect(isNewerVersion('2.2.0', null)).toBe(false)
    expect(isNewerVersion('', '2.1.0')).toBe(false)
    expect(isNewerVersion('latest', '2.1.0')).toBe(false)
    expect(isNewerVersion('2.2.0', 'unknown')).toBe(false)
  })
})
