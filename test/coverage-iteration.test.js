import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compareSummaries,
  CoverageIterationTracker
} from '../coverage-iteration.js'

const failureConfig = limit => ({
  scanner_parameters: {
    measurement_stop_policy: 'num_detect_failures',
    measurement_num_detect_failures_limit: limit
  }
})

const timeoutConfig = seconds => ({
  scanner_parameters: {
    measurement_stop_policy: 'detect_timeout',
    measurement_detect_timeout: seconds
  }
})

const scan = (
  cell,
  { scanIteration = 0, decode = false, rssi = -80 } = {}
) => ({
  tech: cell.tech || 'lte',
  pci: cell.pci,
  frequency_mhz: cell.frequency_mhz || 1930,
  scan_iteration: scanIteration,
  rssi,
  ...(decode ? { mib: {} } : {})
})

const cellA = { pci: 1, frequency_mhz: 1930 }
const cellB = { pci: 2, frequency_mhz: 1930 }
const cellC = { pci: 3, frequency_mhz: 1930 }

test('records complete coverage iterations for a stable roster', () => {
  const tracker = new CoverageIterationTracker({
    config: failureConfig(20),
    warmupMs: 1000,
    measurementMs: 1000
  })

  tracker.processScan(scan(cellA, { scanIteration: 0, decode: true }), 0)
  tracker.processScan(scan(cellB, { scanIteration: 0, decode: true }), 10)
  tracker.finishWarmup(1000)
  tracker.processScan(scan(cellA, { scanIteration: 1 }), 1100)
  tracker.processScan(scan(cellB, { scanIteration: 1 }), 1300)
  tracker.finishRun(1400)

  const summary = tracker.getSummary({ label: 'stable' })
  const complete = summary.iterations.find(
    iteration => iteration.status === 'complete'
  )

  assert.equal(summary.candidateRoster.length, 2)
  assert.equal(complete.durationMs, 300)
  assert.equal(complete.cellsRequired, 2)
  assert.equal(complete.durationPerCellMs, 150)
  assert.equal(complete.slowestCell.cellId, 'lte-2-1930')
  assert.equal(summary.iterationStats.complete.meanMs, 300)
  assert.equal(summary.iterationStats.complete.meanMsPerCell, 150)
})

test('captures per-cell fairness when one cell is slow', () => {
  const tracker = new CoverageIterationTracker({
    config: failureConfig(20),
    warmupMs: 1000,
    measurementMs: 1000
  })

  tracker.processScan(scan(cellA, { scanIteration: 0, decode: true }), 0)
  tracker.processScan(scan(cellB, { scanIteration: 0, decode: true }), 10)
  tracker.finishWarmup(1000)
  tracker.processScan(scan(cellA, { scanIteration: 1 }), 1010)
  tracker.processScan(scan(cellB, { scanIteration: 1 }), 1900)
  tracker.finishRun(2000)

  const summary = tracker.getSummary({ label: 'slow-cell' })
  const cellAStats = summary.perCell.find(cell => cell.cellId === 'lte-1-1930')
  const cellBStats = summary.perCell.find(cell => cell.cellId === 'lte-2-1930')
  const complete = summary.iterations.find(
    iteration => iteration.status === 'complete'
  )

  assert.equal(complete.slowestCell.cellId, 'lte-2-1930')
  assert.equal(cellAStats.maxMeasurementLatencyMs, 10)
  assert.equal(cellBStats.maxMeasurementLatencyMs, 900)
})

test('marks an iteration complete_after_stale when a pending cell ages out by detect failures', () => {
  const tracker = new CoverageIterationTracker({
    config: failureConfig(3),
    warmupMs: 1000,
    measurementMs: 1000
  })

  tracker.processScan(scan(cellA, { scanIteration: 0, decode: true }), 0)
  tracker.processScan(scan(cellB, { scanIteration: 0, decode: true }), 10)
  tracker.finishWarmup(1000)
  tracker.processScan(scan(cellA, { scanIteration: 1, decode: true }), 1100)
  tracker.processScan(scan(cellA, { scanIteration: 3, decode: true }), 1300)
  tracker.finishRun(1400)

  const summary = tracker.getSummary({ label: 'detect-fail-stale' })
  const settled = summary.iterations.find(
    iteration => iteration.status === 'complete_after_stale'
  )

  assert.equal(settled.durationMs, 300)
  assert.equal(settled.staleCells.length, 1)
  assert.equal(settled.staleCells[0].cellId, 'lte-2-1930')
  assert.equal(summary.rosterHealth.staleRemovalCount, 1)
  assert.equal(summary.iterationStats.complete.count, 0)
  assert.equal(summary.iterationStats.settled.count, 1)
})

test('marks an iteration complete_after_stale when a pending cell ages out by timeout', () => {
  const tracker = new CoverageIterationTracker({
    config: timeoutConfig(1),
    warmupMs: 1000,
    measurementMs: 1000
  })

  tracker.processScan(scan(cellA, { decode: true }), 500)
  tracker.processScan(scan(cellB, { decode: true }), 510)
  tracker.finishWarmup(1000)
  tracker.processScan(scan(cellA, { decode: true }), 1100)
  tracker.processScan(scan(cellA, { decode: true }), 1600)
  tracker.finishRun(1700)

  const summary = tracker.getSummary({ label: 'timeout-stale' })
  const settled = summary.iterations.find(
    iteration => iteration.status === 'complete_after_stale'
  )

  assert.equal(settled.staleCells[0].cellId, 'lte-2-1930')
  assert.equal(settled.staleCells[0].reason, 'detect_timeout')
})

test('tracks re-adds and adds them to the current operational iteration', () => {
  const tracker = new CoverageIterationTracker({
    config: failureConfig(3),
    warmupMs: 1000,
    measurementMs: 1000
  })

  tracker.processScan(scan(cellA, { scanIteration: 0, decode: true }), 0)
  tracker.processScan(scan(cellB, { scanIteration: 0, decode: true }), 10)
  tracker.finishWarmup(1000)
  tracker.processScan(scan(cellA, { scanIteration: 1, decode: true }), 1100)
  tracker.processScan(scan(cellA, { scanIteration: 3, decode: true }), 1300)
  tracker.processScan(scan(cellB, { scanIteration: 4, decode: true }), 1400)
  tracker.processScan(scan(cellA, { scanIteration: 4, decode: true }), 1500)
  tracker.finishRun(1600)

  const summary = tracker.getSummary({ label: 'readd' })
  const cellBStats = summary.perCell.find(cell => cell.cellId === 'lte-2-1930')
  const complete = summary.iterations.find(
    iteration => iteration.status === 'complete'
  )

  assert.equal(cellBStats.readdCount, 1)
  assert.deepEqual(complete.requiredCells, ['lte-1-1930', 'lte-2-1930'])
  assert.deepEqual(complete.cellsAddedDuringIteration, [
    {
      cellId: 'lte-2-1930',
      timestampMs: 1400,
      scanIteration: 4,
      inCandidateRoster: true
    }
  ])
})

test('adds decoded cells after warmup to the operational roster', () => {
  const tracker = new CoverageIterationTracker({
    config: failureConfig(20),
    warmupMs: 1000,
    measurementMs: 1000
  })

  tracker.processScan(scan(cellA, { scanIteration: 0, decode: true }), 0)
  tracker.finishWarmup(1000)
  tracker.processScan(scan(cellC, { scanIteration: 1, decode: true }), 1100)
  tracker.processScan(scan(cellA, { scanIteration: 1 }), 1200)
  tracker.finishRun(1300)

  const summary = tracker.getSummary({ label: 'frozen-roster' })

  assert.deepEqual(
    summary.candidateRoster.map(cell => cell.cellId),
    ['lte-1-1930']
  )
  assert.deepEqual(
    summary.activeRosterAtEnd.map(cell => cell.cellId),
    ['lte-1-1930', 'lte-3-1930']
  )
  assert.equal(summary.rosterHealth.lateDiscoveredCellCount, 1)
  assert.equal(summary.iterations[0].cellsRequired, 2)
  assert.deepEqual(summary.iterations[0].cellsAddedDuringIteration, [
    {
      cellId: 'lte-3-1930',
      timestampMs: 1100,
      scanIteration: 1,
      inCandidateRoster: false
    }
  ])
})

test('compares old and new report summaries using normalized coverage time', () => {
  const oldTracker = new CoverageIterationTracker({
    config: failureConfig(20),
    warmupMs: 1000,
    measurementMs: 1000
  })
  oldTracker.processScan(scan(cellA, { decode: true }), 0)
  oldTracker.processScan(scan(cellB, { decode: true }), 10)
  oldTracker.finishWarmup(1000)
  oldTracker.processScan(scan(cellA), 1500)
  oldTracker.processScan(scan(cellB), 2000)
  oldTracker.finishRun(3000)

  const newTracker = new CoverageIterationTracker({
    config: failureConfig(20),
    warmupMs: 1000,
    measurementMs: 1000
  })
  newTracker.processScan(scan(cellA, { decode: true }), 0)
  newTracker.finishWarmup(1000)
  newTracker.processScan(scan(cellA), 3000)
  newTracker.finishRun(4000)

  const comparison = compareSummaries(
    oldTracker.getSummary({ label: 'old' }),
    newTracker.getSummary({ label: 'new' })
  )
  const meanMetric = comparison.metrics.find(
    metric => metric.name === 'Mean normalized operational coverage'
  )

  assert.equal(meanMetric.baseline, 500)
  assert.equal(meanMetric.candidate, 2000)
  assert.equal(meanMetric.percentChange, 300)
})
