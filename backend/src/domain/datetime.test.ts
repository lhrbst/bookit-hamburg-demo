import { describe, expect, it } from 'vitest';
import { parseBerlinLocalDateTime } from './datetime';

describe('parseBerlinLocalDateTime', () => {
  it('parses a normal local date-time', () => {
    const result = parseBerlinLocalDateTime('2026-06-01T14:00');
    expect(result.ok).toBe(true);
  });

  it('rejects an undefined/blank value as invalid', () => {
    expect(parseBerlinLocalDateTime(undefined)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseBerlinLocalDateTime('   ')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects an out-of-range calendar component as invalid', () => {
    const result = parseBerlinLocalDateTime('2026-02-31T10:00');
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('reports the non-existent spring-forward hour distinctly', () => {
    const result = parseBerlinLocalDateTime('2026-03-29T02:30');
    expect(result).toEqual({ ok: false, reason: 'nonexistent' });
  });

  it('reports the ambiguous fall-back hour distinctly', () => {
    const result = parseBerlinLocalDateTime('2026-10-25T02:30');
    expect(result).toEqual({ ok: false, reason: 'ambiguous' });
  });
});
