import { describe, it, expect } from 'vitest'
import { calculateOptimalBatchSize } from '../auto-batch.js'

describe('calculateOptimalBatchSize', () => {
  it('returns MAX_BATCH_SIZE (5000) for very narrow tables', () => {
    // 1 column, should get maximum batch size
    const result = calculateOptimalBatchSize(1)
    expect(result).toBe(5000)
  })

  it('returns large batch size for narrow tables (few columns)', () => {
    // 3 columns at default ~30 bytes each
    const result = calculateOptimalBatchSize(3)
    expect(result).toBeGreaterThanOrEqual(1000)
    expect(result).toBeLessThanOrEqual(5000)
  })

  it('returns smaller batch size for wide tables (many columns)', () => {
    // 50 columns at default width -> rows are ~1500 bytes each
    const result = calculateOptimalBatchSize(50)
    expect(result).toBeLessThan(1000)
    expect(result).toBeGreaterThanOrEqual(100)
  })

  it('returns MIN_BATCH_SIZE (100) for very wide tables', () => {
    // 500 columns at default width -> rows are very large
    const result = calculateOptimalBatchSize(500)
    expect(result).toBe(100)
  })

  it('uses avgRowWidth when provided', () => {
    // 10 columns, but very large average row (10KB)
    const result = calculateOptimalBatchSize(10, 10000)
    expect(result).toBeLessThan(200)
    expect(result).toBeGreaterThanOrEqual(100)
  })

  it('returns larger batch when avgRowWidth is small', () => {
    // 10 columns, but very compact rows (5 bytes each)
    const result = calculateOptimalBatchSize(10, 5)
    expect(result).toBe(5000)
  })

  it('clamps to MIN_BATCH_SIZE for extremely wide rows', () => {
    // 5 columns but each row is 500KB
    const result = calculateOptimalBatchSize(5, 500000)
    expect(result).toBe(100)
  })

  it('clamps to MAX_BATCH_SIZE for extremely narrow rows', () => {
    // 1 column, 1 byte per row
    const result = calculateOptimalBatchSize(1, 1)
    expect(result).toBe(5000)
  })

  it('handles zero columns gracefully', () => {
    const result = calculateOptimalBatchSize(0)
    expect(result).toBe(5000)
  })

  it('handles negative column count gracefully', () => {
    const result = calculateOptimalBatchSize(-1)
    expect(result).toBe(5000)
  })

  it('handles zero avgRowWidth gracefully', () => {
    const result = calculateOptimalBatchSize(5, 0)
    expect(result).toBe(5000)
  })

  it('handles negative avgRowWidth gracefully', () => {
    const result = calculateOptimalBatchSize(5, -10)
    expect(result).toBe(5000)
  })

  it('returns different batch sizes for different table widths', () => {
    const narrow = calculateOptimalBatchSize(2)
    const medium = calculateOptimalBatchSize(20)
    const wide = calculateOptimalBatchSize(100)

    expect(narrow).toBeGreaterThanOrEqual(medium)
    expect(medium).toBeGreaterThanOrEqual(wide)
  })

  it('batch size decreases monotonically with increasing column count', () => {
    const sizes = [5, 10, 20, 50, 100].map((cols) =>
      calculateOptimalBatchSize(cols),
    )

    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1])
    }
  })

  it('keeps result within valid range [100, 5000]', () => {
    // Test a variety of inputs
    const testCases = [
      { cols: 1, width: undefined },
      { cols: 1, width: 1 },
      { cols: 500, width: 1000 },
      { cols: 2, width: 5000000 },
      { cols: 100, width: 100 },
    ]

    for (const tc of testCases) {
      const result = calculateOptimalBatchSize(tc.cols, tc.width)
      expect(result).toBeGreaterThanOrEqual(100)
      expect(result).toBeLessThanOrEqual(5000)
    }
  })
})
