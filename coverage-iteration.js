const hasValue = value => value !== undefined && value !== null
const isFiniteNumber = value => Number.isFinite(value)

export const makeCellId = event => {
  const frequency = event.frequency_mhz ?? event.frequency_hz ?? event.earfcn

  if (!hasValue(event.tech) || !hasValue(event.pci) || !hasValue(frequency)) {
    return null
  }

  return `${event.tech}-${event.pci}-${frequency}`
}

export const isDecodeEvent = event => event.mib != null

export class CoverageIterationTracker {
  constructor({ config = {}, warmupMs = 60000, measurementMs = 300000 } = {}) {
    const scannerParams = config.scanner_parameters || {}

    this.config = config
    this.warmupMs = warmupMs
    this.measurementMs = measurementMs
    this.stopPolicy = scannerParams.measurement_stop_policy
    this.detectFailureLimit = Number(
      scannerParams.measurement_num_detect_failures_limit
    )
    this.detectTimeoutSeconds = Number(scannerParams.measurement_detect_timeout)

    this.phase = 'warmup'
    this.startedAtMs = null
    this.measurementStartMs = null
    this.measurementEndMs = null

    this.candidateFrozen = false
    this.candidateRoster = new Set()
    this.activeCells = new Map()
    this.cellStats = new Map()
    this.lifecycleEvents = []
    this.iterations = []
    this.currentIteration = null

    this.rawScanCount = 0
    this.measurementScanCount = 0
    this.candidateMeasurementScanCount = 0
    this.lateDiscoveredCellIds = new Set()
  }

  start(timestampMs) {
    if (this.startedAtMs == null) {
      this.startedAtMs = timestampMs
    }
  }

  finishWarmup(timestampMs) {
    this.start(timestampMs)

    if (this.phase !== 'warmup') {
      return
    }

    this.candidateFrozen = true
    this.phase = 'measuring'
    this.measurementStartMs = timestampMs
    this.addLifecycleEvent('candidate_roster_frozen', null, timestampMs, {
      rosterSize: this.candidateRoster.size
    })
    this.startNextIteration(timestampMs)
  }

  finishRun(timestampMs) {
    if (this.phase === 'done') {
      return
    }

    if (this.phase === 'warmup') {
      this.finishWarmup(timestampMs)
    }

    this.measurementEndMs = timestampMs

    if (this.currentIteration != null) {
      // A settled iteration eagerly seeds the next one at the same timestamp so
      // we can measure latency from the prior completion. If the run ends before
      // another scan arrives, that zero-scan placeholder should not be reported
      // as a real incomplete iteration.
      if (
        this.currentIteration.scansConsumed === 0 &&
        this.iterations.length > 0
      ) {
        this.currentIteration = null
      } else {
        this.finalizeCurrentIteration('incomplete', timestampMs)
      }
      this.currentIteration = null
    }

    this.phase = 'done'
  }

  processScan(event, timestampMs = Date.now()) {
    if (this.phase === 'done') {
      return
    }

    this.start(timestampMs)
    this.rawScanCount += 1

    const cellId = makeCellId(event)
    if (cellId == null) {
      return
    }

    const scanIteration = event.scan_iteration
    this.recordCellScan(cellId, event, timestampMs)

    if (this.phase === 'warmup') {
      this.processWarmupScan(cellId, event, timestampMs, scanIteration)
      return
    }

    this.processMeasurementScan(cellId, event, timestampMs, scanIteration)
  }

  getSummary(metadata = {}) {
    const completeIterations = this.iterations.filter(
      iteration => iteration.status === 'complete'
    )
    const completeAfterStaleIterations = this.iterations.filter(
      iteration => iteration.status === 'complete_after_stale'
    )
    const settledIterations = [
      ...completeIterations,
      ...completeAfterStaleIterations
    ]
    const candidateCompleteIterations = this.iterations.filter(
      iteration => iteration.candidateStatus === 'complete'
    )
    const candidateCompleteAfterStaleIterations = this.iterations.filter(
      iteration => iteration.candidateStatus === 'complete_after_stale'
    )
    const candidateSettledIterations = [
      ...candidateCompleteIterations,
      ...candidateCompleteAfterStaleIterations
    ]
    const completedIterations = this.iterations.filter(
      iteration => iteration.status !== 'incomplete'
    )
    const affectedByStale = completedIterations.filter(
      iteration => iteration.staleCells.length > 0
    )
    const measurementDurationMs =
      this.measurementStartMs != null && this.measurementEndMs != null
        ? this.measurementEndMs - this.measurementStartMs
        : null
    const measurementLifecycleEvents = this.lifecycleEvents.filter(
      event => event.phase === 'measuring'
    )
    const staleRemovalCount = measurementLifecycleEvents.filter(
      event => event.type === 'stale_removed'
    ).length
    const readdCount = measurementLifecycleEvents.filter(
      event => event.type === 'cell_readded'
    ).length
    const lateDiscoveredCount = measurementLifecycleEvents.filter(
      event => event.type === 'late_cell_discovered'
    ).length
    const lateMeasurementScanCount =
      this.measurementScanCount - this.candidateMeasurementScanCount

    return {
      schema_version: 2,
      metadata: {
        ...metadata,
        generatedAt: new Date().toISOString(),
        warmupSeconds: this.warmupMs / 1000,
        durationSeconds: this.measurementMs / 1000
      },
      config: this.config,
      candidateRoster: [...this.candidateRoster]
        .sort()
        .map(cellId => this.describeCell(cellId)),
      activeRosterAtEnd: [...this.activeCells.keys()]
        .sort()
        .map(cellId => this.describeCell(cellId)),
      measurement: {
        startedAtMs: this.measurementStartMs,
        endedAtMs: this.measurementEndMs,
        durationMs: measurementDurationMs,
        rawScanCount: this.rawScanCount,
        measurementScanCount: this.measurementScanCount,
        candidateMeasurementScanCount: this.candidateMeasurementScanCount,
        lateMeasurementScanCount,
        rawScansPerSecond:
          measurementDurationMs > 0
            ? (this.measurementScanCount / measurementDurationMs) * 1000
            : null,
        candidateScansPerSecond:
          measurementDurationMs > 0
            ? (this.candidateMeasurementScanCount / measurementDurationMs) *
              1000
            : null,
        lateScansPerSecond:
          measurementDurationMs > 0
            ? (lateMeasurementScanCount / measurementDurationMs) * 1000
            : null,
        lateScanSharePercent:
          this.measurementScanCount > 0
            ? (lateMeasurementScanCount / this.measurementScanCount) * 100
            : null
      },
      iterationStats: {
        complete: iterationStats(completeIterations, measurementDurationMs),
        completeAfterStale: iterationStats(
          completeAfterStaleIterations,
          measurementDurationMs
        ),
        settled: iterationStats(settledIterations, measurementDurationMs),
        incompleteCount: this.iterations.filter(
          iteration => iteration.status === 'incomplete'
        ).length
      },
      comparisonRosterStats: {
        complete: candidateIterationStats(
          candidateCompleteIterations,
          measurementDurationMs
        ),
        completeAfterStale: candidateIterationStats(
          candidateCompleteAfterStaleIterations,
          measurementDurationMs
        ),
        settled: candidateIterationStats(
          candidateSettledIterations,
          measurementDurationMs
        )
      },
      rosterHealth: {
        staleRemovalCount,
        staleRemovalsPerMinute:
          measurementDurationMs > 0
            ? staleRemovalCount / (measurementDurationMs / 60000)
            : null,
        lateDiscoveredCount,
        lateDiscoveredCellCount: this.lateDiscoveredCellIds.size,
        lateDiscoveredCells: [...this.lateDiscoveredCellIds]
          .sort()
          .map(cellId => this.describeCell(cellId)),
        iterationsAffectedByStaleCount: affectedByStale.length,
        iterationsAffectedByStalePercent:
          completedIterations.length > 0
            ? (affectedByStale.length / completedIterations.length) * 100
            : null,
        readdCount
      },
      perCell: [...this.cellStats.values()]
        .map(cell => this.summarizeCell(cell))
        .sort((a, b) => {
          if (a.inCandidateRoster !== b.inCandidateRoster) {
            return a.inCandidateRoster ? -1 : 1
          }
          return a.cellId.localeCompare(b.cellId)
        }),
      iterations: this.iterations,
      lifecycleEvents: this.lifecycleEvents
    }
  }

  processWarmupScan(cellId, event, timestampMs, scanIteration) {
    if (isDecodeEvent(event)) {
      this.addOrRefreshCell(cellId, event, timestampMs, scanIteration)
    }

    this.removeStaleCells(
      [...this.activeCells.keys()],
      timestampMs,
      scanIteration
    )
  }

  processMeasurementScan(cellId, event, timestampMs, scanIteration) {
    this.measurementScanCount += 1

    if (isDecodeEvent(event)) {
      this.addOrRefreshCell(cellId, event, timestampMs, scanIteration)
    }

    if (this.candidateRoster.has(cellId)) {
      this.candidateMeasurementScanCount += 1
    }

    if (this.currentIteration == null && this.activeCells.size > 0) {
      this.startNextIteration(timestampMs)
    }

    if (this.currentIteration != null) {
      this.currentIteration.scansConsumed += 1
    }

    if (
      this.currentIteration != null &&
      this.activeCells.has(cellId) &&
      this.currentIteration.pending.has(cellId)
    ) {
      this.markCellMeasured(cellId, timestampMs, scanIteration)
    }

    if (this.currentIteration == null) {
      return
    }

    this.removeStaleCells(
      [...this.currentIteration.pending],
      timestampMs,
      scanIteration,
      this.currentIteration
    )

    if (this.currentIteration.pending.size === 0) {
      const status =
        this.currentIteration.staleCells.length > 0
          ? 'complete_after_stale'
          : 'complete'
      this.finalizeCurrentIteration(status, timestampMs)
      this.startNextIteration(timestampMs)
    }
  }

  addOrRefreshCell(cellId, event, timestampMs, scanIteration) {
    const cell = this.getOrCreateCellStats(cellId, event, timestampMs)
    const wasCandidate = this.candidateRoster.has(cellId)
    const wasActive = this.activeCells.has(cellId)
    const isLateDiscovered = this.candidateFrozen && !wasCandidate

    cell.decodeCount += 1
    cell.lastDecodeAtMs = timestampMs
    cell.lastDecodeScanIteration = scanIteration

    if (!this.candidateFrozen && !wasCandidate) {
      this.candidateRoster.add(cellId)
      this.addLifecycleEvent('cell_added', cellId, timestampMs, {
        scanIteration
      })
    } else if (isLateDiscovered && !cell.lateDiscovered) {
      cell.lateDiscovered = true
      cell.firstLateDiscoveredAtMs = timestampMs
      this.lateDiscoveredCellIds.add(cellId)
      this.addLifecycleEvent('late_cell_discovered', cellId, timestampMs, {
        scanIteration
      })
    }

    this.activeCells.set(cellId, {
      decodeIteration: scanIteration,
      decodeTimeMs: timestampMs
    })
    this.addActiveCellToCurrentIteration(cellId, timestampMs, scanIteration)

    if (wasActive) {
      this.addLifecycleEvent('decode_refresh', cellId, timestampMs, {
        scanIteration
      })
    } else if (cell.staleCount > 0) {
      cell.readdCount += 1
      this.addLifecycleEvent('cell_readded', cellId, timestampMs, {
        scanIteration
      })
    } else if (wasCandidate) {
      this.addLifecycleEvent('cell_activated', cellId, timestampMs, {
        scanIteration
      })
    }
  }

  removeStaleCells(cellIds, timestampMs, scanIteration, iteration = null) {
    const staleCells = []

    for (const cellId of cellIds) {
      const activeCell = this.activeCells.get(cellId)
      if (activeCell == null) {
        continue
      }

      const staleInfo = this.getStaleInfo(
        activeCell,
        timestampMs,
        scanIteration
      )
      if (staleInfo == null) {
        continue
      }

      this.activeCells.delete(cellId)
      const cell = this.cellStats.get(cellId)
      if (cell != null) {
        cell.staleCount += 1
        cell.lastStaleAtMs = timestampMs
      }

      const staleRecord = {
        cellId,
        timestampMs,
        scanIteration,
        reason: staleInfo.reason,
        value: staleInfo.value,
        threshold: staleInfo.threshold
      }

      staleCells.push(staleRecord)
      this.addLifecycleEvent('stale_removed', cellId, timestampMs, staleRecord)

      if (iteration != null && iteration.pending.has(cellId)) {
        iteration.pending.delete(cellId)
        iteration.staleCells.push(staleRecord)
      }

      if (iteration != null && iteration.candidatePending.has(cellId)) {
        iteration.candidatePending.delete(cellId)
        iteration.candidateStaleCells.push(staleRecord)
        this.updateCandidateCoverageCompletion(timestampMs)
      }
    }

    return staleCells
  }

  getStaleInfo(activeCell, timestampMs, scanIteration) {
    switch (this.stopPolicy) {
      case 'num_detect_failures': {
        if (
          !Number.isFinite(this.detectFailureLimit) ||
          !Number.isFinite(scanIteration) ||
          !Number.isFinite(activeCell.decodeIteration)
        ) {
          return null
        }

        const failedIterations = scanIteration - activeCell.decodeIteration
        return failedIterations >= this.detectFailureLimit
          ? {
              reason: 'num_detect_failures',
              value: failedIterations,
              threshold: this.detectFailureLimit
            }
          : null
      }

      case 'detect_timeout': {
        if (!Number.isFinite(this.detectTimeoutSeconds)) {
          return null
        }

        const elapsedSeconds = (timestampMs - activeCell.decodeTimeMs) / 1000
        return elapsedSeconds >= this.detectTimeoutSeconds
          ? {
              reason: 'detect_timeout',
              value: elapsedSeconds,
              threshold: this.detectTimeoutSeconds
            }
          : null
      }

      default:
        return null
    }
  }

  startNextIteration(timestampMs) {
    if (this.activeCells.size === 0) {
      this.currentIteration = null
      return
    }

    const requiredCells = [...this.activeCells.keys()].sort()
    const candidateRequiredCells = requiredCells.filter(cellId =>
      this.candidateRoster.has(cellId)
    )
    const index = this.iterations.length + 1
    this.currentIteration = {
      index,
      startMs: timestampMs,
      endMs: null,
      status: null,
      requiredCells,
      candidateRequiredCells,
      pending: new Set(requiredCells),
      candidatePending: new Set(candidateRequiredCells),
      measuredCells: [],
      staleCells: [],
      candidateStaleCells: [],
      candidateCompletedAtMs:
        candidateRequiredCells.length === 0 ? timestampMs : null,
      candidateStatus:
        candidateRequiredCells.length === 0 ? 'no_candidate_cells' : null,
      cellsAddedDuringIteration: [],
      scansConsumed: 0
    }
  }

  addActiveCellToCurrentIteration(cellId, timestampMs, scanIteration) {
    const iteration = this.currentIteration
    if (
      this.phase !== 'measuring' ||
      iteration == null ||
      iteration.requiredCells.includes(cellId)
    ) {
      return
    }

    iteration.requiredCells.push(cellId)
    iteration.requiredCells.sort()
    iteration.pending.add(cellId)
    iteration.cellsAddedDuringIteration.push({
      cellId,
      timestampMs,
      scanIteration,
      inCandidateRoster: this.candidateRoster.has(cellId)
    })

    if (this.candidateRoster.has(cellId)) {
      iteration.candidateRequiredCells.push(cellId)
      iteration.candidateRequiredCells.sort()
      iteration.candidatePending.add(cellId)
      iteration.candidateCompletedAtMs = null
      iteration.candidateStatus = null
    }
  }

  markCellMeasured(cellId, timestampMs, scanIteration) {
    const iteration = this.currentIteration
    const latencyMs = timestampMs - iteration.startMs
    const measurement = {
      cellId,
      timestampMs,
      latencyMs,
      scanIteration
    }

    iteration.pending.delete(cellId)
    iteration.measuredCells.push(measurement)

    if (iteration.candidatePending.has(cellId)) {
      iteration.candidatePending.delete(cellId)
      this.updateCandidateCoverageCompletion(timestampMs)
    }

    const cell = this.cellStats.get(cellId)
    if (cell != null) {
      cell.measurementCount += 1
      cell.totalMeasurementLatencyMs += latencyMs
      cell.maxMeasurementLatencyMs =
        cell.maxMeasurementLatencyMs == null
          ? latencyMs
          : Math.max(cell.maxMeasurementLatencyMs, latencyMs)
      cell.lastMeasurementLatencyMs = latencyMs
      cell.lastMeasurementAtMs = timestampMs
    }
  }

  updateCandidateCoverageCompletion(timestampMs) {
    const iteration = this.currentIteration
    if (
      iteration == null ||
      iteration.candidateCompletedAtMs != null ||
      iteration.candidatePending.size > 0
    ) {
      return
    }

    iteration.candidateCompletedAtMs = timestampMs
    iteration.candidateStatus =
      iteration.candidateStaleCells.length > 0
        ? 'complete_after_stale'
        : 'complete'
  }

  finalizeCurrentIteration(status, timestampMs) {
    const iteration = this.currentIteration
    const measuredCells = [...iteration.measuredCells]
    const missingCells = [...iteration.pending].sort()
    const slowestCell = measuredCells.reduce((slowest, cell) => {
      if (slowest == null || cell.latencyMs > slowest.latencyMs) {
        return cell
      }
      return slowest
    }, null)
    const candidateMeasuredCells = measuredCells.filter(cell =>
      this.candidateRoster.has(cell.cellId)
    )
    const candidateMissingCells = [...iteration.candidatePending].sort()
    const candidateDurationMs =
      iteration.candidateCompletedAtMs == null
        ? timestampMs - iteration.startMs
        : iteration.candidateCompletedAtMs - iteration.startMs
    const candidateStatus =
      iteration.candidateStatus ||
      (status === 'incomplete' ? 'incomplete' : status)

    this.iterations.push({
      index: iteration.index,
      status,
      startMs: iteration.startMs,
      endMs: timestampMs,
      durationMs: timestampMs - iteration.startMs,
      durationPerCellMs:
        iteration.requiredCells.length > 0
          ? (timestampMs - iteration.startMs) / iteration.requiredCells.length
          : null,
      requiredCells: [...iteration.requiredCells],
      candidateRequiredCells: [...iteration.candidateRequiredCells],
      measuredCells,
      staleCells: [...iteration.staleCells],
      candidateStatus,
      candidateDurationMs,
      candidateDurationPerCellMs:
        iteration.candidateRequiredCells.length > 0
          ? candidateDurationMs / iteration.candidateRequiredCells.length
          : null,
      candidateMeasuredCells,
      candidateStaleCells: [...iteration.candidateStaleCells],
      candidateMissingCells,
      missingCells,
      cellsRequired: iteration.requiredCells.length,
      candidateCellsRequired: iteration.candidateRequiredCells.length,
      cellsMeasured: measuredCells.length,
      candidateCellsMeasured: candidateMeasuredCells.length,
      scansConsumed: iteration.scansConsumed,
      slowestCell,
      cellsAddedDuringIteration: [...iteration.cellsAddedDuringIteration]
    })
  }

  recordCellScan(cellId, event, timestampMs) {
    const cell = this.getOrCreateCellStats(cellId, event, timestampMs)
    cell.scanCount += 1
    cell.lastScanAtMs = timestampMs
    cell.lastScanIteration = event.scan_iteration
  }

  getOrCreateCellStats(cellId, event, timestampMs) {
    if (!this.cellStats.has(cellId)) {
      this.cellStats.set(cellId, {
        cellId,
        tech: event.tech ?? null,
        pci: event.pci ?? null,
        frequency_mhz: event.frequency_mhz ?? null,
        frequency_hz: event.frequency_hz ?? null,
        earfcn: event.earfcn ?? null,
        firstSeenAtMs: timestampMs,
        lastScanAtMs: null,
        lastScanIteration: null,
        scanCount: 0,
        decodeCount: 0,
        lastDecodeAtMs: null,
        lastDecodeScanIteration: null,
        measurementCount: 0,
        totalMeasurementLatencyMs: 0,
        maxMeasurementLatencyMs: null,
        lastMeasurementLatencyMs: null,
        lastMeasurementAtMs: null,
        staleCount: 0,
        lastStaleAtMs: null,
        readdCount: 0,
        lateDiscovered: false,
        firstLateDiscoveredAtMs: null
      })
    }

    const cell = this.cellStats.get(cellId)
    cell.tech = cell.tech ?? event.tech ?? null
    cell.pci = cell.pci ?? event.pci ?? null
    cell.frequency_mhz = cell.frequency_mhz ?? event.frequency_mhz ?? null
    cell.frequency_hz = cell.frequency_hz ?? event.frequency_hz ?? null
    cell.earfcn = cell.earfcn ?? event.earfcn ?? null

    return cell
  }

  describeCell(cellId) {
    const cell = this.cellStats.get(cellId)
    if (cell == null) {
      return { cellId }
    }

    return {
      cellId,
      tech: cell.tech,
      pci: cell.pci,
      frequency_mhz: cell.frequency_mhz,
      frequency_hz: cell.frequency_hz,
      earfcn: cell.earfcn
    }
  }

  summarizeCell(cell) {
    return {
      ...this.describeCell(cell.cellId),
      inCandidateRoster: this.candidateRoster.has(cell.cellId),
      activeAtEnd: this.activeCells.has(cell.cellId),
      firstSeenAtMs: cell.firstSeenAtMs,
      lastScanAtMs: cell.lastScanAtMs,
      lastDecodeAtMs: cell.lastDecodeAtMs,
      lastMeasurementAtMs: cell.lastMeasurementAtMs,
      timeSinceLastMeasurementMs:
        this.measurementEndMs != null && cell.lastMeasurementAtMs != null
          ? this.measurementEndMs - cell.lastMeasurementAtMs
          : null,
      scanCount: cell.scanCount,
      decodeCount: cell.decodeCount,
      measurementCount: cell.measurementCount,
      averageMeasurementLatencyMs:
        cell.measurementCount > 0
          ? cell.totalMeasurementLatencyMs / cell.measurementCount
          : null,
      maxMeasurementLatencyMs: cell.maxMeasurementLatencyMs,
      lastMeasurementLatencyMs: cell.lastMeasurementLatencyMs,
      staleCount: cell.staleCount,
      lastStaleAtMs: cell.lastStaleAtMs,
      readdCount: cell.readdCount,
      lateDiscovered: cell.lateDiscovered,
      firstLateDiscoveredAtMs: cell.firstLateDiscoveredAtMs
    }
  }

  addLifecycleEvent(type, cellId, timestampMs, details = {}) {
    this.lifecycleEvents.push({
      type,
      cellId,
      timestampMs,
      elapsedMs:
        this.startedAtMs == null ? null : timestampMs - this.startedAtMs,
      phase: this.phase,
      ...details
    })
  }
}

export const iterationStats = (iterations, measurementDurationMs = null) => {
  const durations = iterations.map(iteration => iteration.durationMs)
  const stats = durationStats(durations)
  const durationPerCell = iterations
    .map(iteration => iteration.durationPerCellMs)
    .filter(isFiniteNumber)
  const durationPerCellStats = durationStats(durationPerCell)
  const cellsCovered = iterations.reduce(
    (total, iteration) => total + iteration.cellsRequired,
    0
  )

  return {
    ...stats,
    meanMsPerCell: durationPerCellStats.meanMs,
    medianMsPerCell: durationPerCellStats.medianMs,
    p90MsPerCell: durationPerCellStats.p90Ms,
    p95MsPerCell: durationPerCellStats.p95Ms,
    cellsPerSecond:
      durationPerCellStats.meanMs > 0
        ? 1000 / durationPerCellStats.meanMs
        : null,
    cellsCovered,
    cellsCoveredPerMinute:
      measurementDurationMs > 0
        ? cellsCovered / (measurementDurationMs / 60000)
        : null,
    iterationsPerMinute:
      measurementDurationMs > 0
        ? iterations.length / (measurementDurationMs / 60000)
        : null
  }
}

export const candidateIterationStats = (
  iterations,
  measurementDurationMs = null
) => {
  const candidateIterations = iterations.filter(
    iteration => iteration.candidateCellsRequired > 0
  )
  const durations = candidateIterations.map(
    iteration => iteration.candidateDurationMs
  )
  const stats = durationStats(durations)
  const durationPerCell = candidateIterations
    .map(iteration => iteration.candidateDurationPerCellMs)
    .filter(isFiniteNumber)
  const durationPerCellStats = durationStats(durationPerCell)
  const cellsCovered = candidateIterations.reduce(
    (total, iteration) => total + iteration.candidateCellsRequired,
    0
  )

  return {
    ...stats,
    meanMsPerCell: durationPerCellStats.meanMs,
    medianMsPerCell: durationPerCellStats.medianMs,
    p90MsPerCell: durationPerCellStats.p90Ms,
    p95MsPerCell: durationPerCellStats.p95Ms,
    cellsPerSecond:
      durationPerCellStats.meanMs > 0
        ? 1000 / durationPerCellStats.meanMs
        : null,
    cellsCovered,
    cellsCoveredPerMinute:
      measurementDurationMs > 0
        ? cellsCovered / (measurementDurationMs / 60000)
        : null,
    iterationsPerMinute:
      measurementDurationMs > 0
        ? candidateIterations.length / (measurementDurationMs / 60000)
        : null
  }
}

export const durationStats = values => {
  if (values.length === 0) {
    return {
      count: 0,
      meanMs: null,
      medianMs: null,
      p90Ms: null,
      p95Ms: null,
      minMs: null,
      maxMs: null,
      stddevMs: null
    }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  const variance =
    values.reduce((total, value) => total + Math.pow(value - mean, 2), 0) /
    values.length

  return {
    count: values.length,
    meanMs: mean,
    medianMs: percentile(sorted, 50),
    p90Ms: percentile(sorted, 90),
    p95Ms: percentile(sorted, 95),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    stddevMs: Math.sqrt(variance)
  }
}

export const compareSummaries = (baseline, candidate) => {
  const baselineComplete = baseline.iterationStats.complete
  const candidateComplete = candidate.iterationStats.complete
  const baselineSettled = baseline.iterationStats.settled
  const candidateSettled = candidate.iterationStats.settled
  const baselineComparisonComplete =
    baseline.comparisonRosterStats?.complete || baselineComplete
  const candidateComparisonComplete =
    candidate.comparisonRosterStats?.complete || candidateComplete

  return {
    baselineLabel: baseline.metadata?.label || 'baseline',
    candidateLabel: candidate.metadata?.label || 'candidate',
    metrics: [
      compareMetric(
        'Mean normalized operational coverage',
        baselineComplete.meanMsPerCell,
        candidateComplete.meanMsPerCell,
        'ms/cell',
        'lower'
      ),
      compareMetric(
        'Median normalized operational coverage',
        baselineComplete.medianMsPerCell,
        candidateComplete.medianMsPerCell,
        'ms/cell',
        'lower'
      ),
      compareMetric(
        'P95 normalized operational coverage',
        baselineComplete.p95MsPerCell,
        candidateComplete.p95MsPerCell,
        'ms/cell',
        'lower'
      ),
      compareMetric(
        'Operational cell coverage throughput',
        baselineComplete.cellsPerSecond,
        candidateComplete.cellsPerSecond,
        ' cells/s',
        'higher'
      ),
      compareMetric(
        'Mean normalized comparison roster coverage',
        baselineComparisonComplete.meanMsPerCell,
        candidateComparisonComplete.meanMsPerCell,
        'ms/cell',
        'lower'
      ),
      compareMetric(
        'Mean complete coverage iteration',
        baselineComplete.meanMs,
        candidateComplete.meanMs,
        'ms',
        'lower'
      ),
      compareMetric(
        'Complete location updates',
        baselineComplete.iterationsPerMinute,
        candidateComplete.iterationsPerMinute,
        '/min',
        'higher'
      ),
      compareMetric(
        'Mean settled location time',
        baselineSettled.meanMs,
        candidateSettled.meanMs,
        'ms',
        'lower'
      ),
      compareMetric(
        'Stale removals',
        baseline.rosterHealth.staleRemovalsPerMinute,
        candidate.rosterHealth.staleRemovalsPerMinute,
        '/min',
        'lower'
      ),
      compareMetric(
        'Iterations affected by stale removals',
        baseline.rosterHealth.iterationsAffectedByStalePercent,
        candidate.rosterHealth.iterationsAffectedByStalePercent,
        '%',
        'lower'
      ),
      compareMetric(
        'Re-add count',
        baseline.rosterHealth.readdCount,
        candidate.rosterHealth.readdCount,
        '',
        'lower'
      ),
      compareMetric(
        'Late-discovered cell count',
        baseline.rosterHealth.lateDiscoveredCellCount,
        candidate.rosterHealth.lateDiscoveredCellCount,
        '',
        'lower'
      ),
      compareMetric(
        'Late scan share',
        baseline.measurement.lateScanSharePercent,
        candidate.measurement.lateScanSharePercent,
        '%',
        'lower'
      )
    ]
  }
}

export const formatMarkdownReport = summary => {
  const complete = summary.iterationStats.complete
  const settled = summary.iterationStats.settled
  const comparisonComplete =
    summary.comparisonRosterStats?.complete || summary.iterationStats.complete
  const stale = summary.rosterHealth
  const topCells = summary.perCell
    .sort(
      (a, b) =>
        nullLastDesc(a.maxMeasurementLatencyMs, b.maxMeasurementLatencyMs) ||
        a.cellId.localeCompare(b.cellId)
    )
    .slice(0, 20)

  return [
    `# Coverage Iteration Report: ${summary.metadata.label || 'unlabeled run'}`,
    '',
    `Generated: ${summary.metadata.generatedAt}`,
    `Remote: ${summary.metadata.remote || 'unknown'}`,
    `Survey: ${summary.metadata.surveyFile || 'unknown'}`,
    `Rx port: ${summary.metadata.rxPort || 'unknown'}`,
    `Warmup: ${summary.metadata.warmupSeconds}s`,
    `Measurement duration: ${formatMs(summary.measurement.durationMs)}`,
    `Stop policy: ${getStopPolicyLabel(summary.config)}`,
    '',
    '## Normalized Coverage Speed',
    '',
    '| Metric | Operational complete | Operational settled | Warmup roster complete |',
    '| --- | ---: | ---: | ---: |',
    `| Count | ${complete.count} | ${settled.count} | ${comparisonComplete.count} |`,
    `| Mean normalized | ${formatMetricValue(
      complete.meanMsPerCell,
      'ms/cell'
    )} | ${formatMetricValue(
      settled.meanMsPerCell,
      'ms/cell'
    )} | ${formatMetricValue(comparisonComplete.meanMsPerCell, 'ms/cell')} |`,
    `| Median normalized | ${formatMetricValue(
      complete.medianMsPerCell,
      'ms/cell'
    )} | ${formatMetricValue(
      settled.medianMsPerCell,
      'ms/cell'
    )} | ${formatMetricValue(comparisonComplete.medianMsPerCell, 'ms/cell')} |`,
    `| P95 normalized | ${formatMetricValue(
      complete.p95MsPerCell,
      'ms/cell'
    )} | ${formatMetricValue(
      settled.p95MsPerCell,
      'ms/cell'
    )} | ${formatMetricValue(comparisonComplete.p95MsPerCell, 'ms/cell')} |`,
    `| Cell throughput | ${formatMetricValue(
      complete.cellsPerSecond,
      ' cells/s'
    )} | ${formatMetricValue(
      settled.cellsPerSecond,
      ' cells/s'
    )} | ${formatMetricValue(comparisonComplete.cellsPerSecond, ' cells/s')} |`,
    '',
    '## Coverage Iteration Duration',
    '',
    '| Metric | Operational complete | Operational settled |',
    '| --- | ---: | ---: |',
    `| Mean | ${formatMs(complete.meanMs)} | ${formatMs(settled.meanMs)} |`,
    `| Median | ${formatMs(complete.medianMs)} | ${formatMs(
      settled.medianMs
    )} |`,
    `| P90 | ${formatMs(complete.p90Ms)} | ${formatMs(settled.p90Ms)} |`,
    `| P95 | ${formatMs(complete.p95Ms)} | ${formatMs(settled.p95Ms)} |`,
    `| Location updates/min | ${formatNumber(
      complete.iterationsPerMinute
    )} | ${formatNumber(settled.iterationsPerMinute)} |`,
    '',
    '## Roster Health',
    '',
    `Candidate roster size: ${summary.candidateRoster.length}`,
    `Active roster at end: ${summary.activeRosterAtEnd.length}`,
    `Late-discovered cells: ${stale.lateDiscoveredCellCount}`,
    `Late-discovered scan share: ${formatPercent(
      summary.measurement.lateScanSharePercent
    )}`,
    `Stale removals: ${stale.staleRemovalCount} (${formatNumber(
      stale.staleRemovalsPerMinute
    )}/min)`,
    `Iterations affected by stale removals: ${
      stale.iterationsAffectedByStaleCount
    } (${formatPercent(stale.iterationsAffectedByStalePercent)})`,
    `Re-adds: ${stale.readdCount}`,
    '',
    '## Per-Cell Fairness',
    '',
    '| Cell | Roster | Scans | Measurements | Avg latency | Max latency | Stale | Re-adds |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...topCells.map(
      cell =>
        `| ${cell.cellId} | ${cell.inCandidateRoster ? 'warmup' : 'late'} | ${
          cell.scanCount
        } | ${cell.measurementCount} | ${formatMs(
          cell.averageMeasurementLatencyMs
        )} | ${formatMs(cell.maxMeasurementLatencyMs)} | ${cell.staleCount} | ${
          cell.readdCount
        } |`
    ),
    '',
    '## Raw Scan Context',
    '',
    `Raw scan rate during measurement: ${formatNumber(
      summary.measurement.rawScansPerSecond
    )}/s`,
    `Candidate scan rate during measurement: ${formatNumber(
      summary.measurement.candidateScansPerSecond
    )}/s`,
    `Late-discovered scan rate during measurement: ${formatNumber(
      summary.measurement.lateScansPerSecond
    )}/s`
  ].join('\n')
}

export const formatComparisonMarkdown = comparison => {
  const headline = comparison.metrics.find(
    metric => metric.name === 'Mean normalized operational coverage'
  )
  const headlineText =
    headline?.percentChange == null
      ? 'Insufficient complete iterations to calculate a headline speed delta.'
      : `${comparison.candidateLabel} is ${formatPercent(
          Math.abs(headline.percentChange)
        )} ${
          headline.percentChange >= 0 ? 'slower' : 'faster'
        } by mean normalized operational coverage time.`

  return [
    `# Coverage Iteration Comparison`,
    '',
    `Baseline: ${comparison.baselineLabel}`,
    `Candidate: ${comparison.candidateLabel}`,
    '',
    headlineText,
    '',
    '| Metric | Baseline | Candidate | Delta | Change |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...comparison.metrics.map(metric => {
      return `| ${metric.name} | ${formatMetricValue(
        metric.baseline,
        metric.unit
      )} | ${formatMetricValue(metric.candidate, metric.unit)} | ${formatDelta(
        metric.delta,
        metric.unit
      )} | ${formatPercent(metric.percentChange)} |`
    })
  ].join('\n')
}

export const formatIterationsCsv = summary => {
  const header = [
    'index',
    'status',
    'start_iso',
    'end_iso',
    'duration_ms',
    'duration_per_cell_ms',
    'cells_required',
    'cells_measured',
    'candidate_duration_ms',
    'candidate_duration_per_cell_ms',
    'candidate_cells_required',
    'candidate_cells_measured',
    'cells_added_during_iteration',
    'stale_cell_count',
    'missing_cell_count',
    'scans_consumed',
    'slowest_cell',
    'slowest_cell_latency_ms',
    'stale_cells',
    'missing_cells'
  ]
  const rows = summary.iterations.map(iteration => [
    iteration.index,
    iteration.status,
    toIso(iteration.startMs),
    toIso(iteration.endMs),
    iteration.durationMs,
    iteration.durationPerCellMs,
    iteration.cellsRequired,
    iteration.cellsMeasured,
    iteration.candidateDurationMs,
    iteration.candidateDurationPerCellMs,
    iteration.candidateCellsRequired,
    iteration.candidateCellsMeasured,
    iteration.cellsAddedDuringIteration.map(cell => cell.cellId).join('|'),
    iteration.staleCells.length,
    iteration.missingCells.length,
    iteration.scansConsumed,
    iteration.slowestCell?.cellId ?? '',
    iteration.slowestCell?.latencyMs ?? '',
    iteration.staleCells.map(cell => cell.cellId).join('|'),
    iteration.missingCells.join('|')
  ])

  return [header, ...rows]
    .map(row => row.map(value => csvEscape(value)).join(','))
    .join('\n')
}

const percentile = (sortedValues, percentileValue) => {
  const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))]
}

const compareMetric = (name, baseline, candidate, unit, betterDirection) => {
  const delta =
    baseline == null || candidate == null ? null : candidate - baseline
  const percentChange =
    baseline == null || baseline === 0 || candidate == null
      ? null
      : (delta / baseline) * 100

  return {
    name,
    baseline,
    candidate,
    delta,
    percentChange,
    unit,
    betterDirection
  }
}

const nullLastDesc = (a, b) => {
  if (a == null && b == null) {
    return 0
  }
  if (a == null) {
    return 1
  }
  if (b == null) {
    return -1
  }
  return b - a
}

const getStopPolicyLabel = config => {
  const scannerParams = config.scanner_parameters || {}
  const policy = scannerParams.measurement_stop_policy || 'unknown'

  if (policy === 'num_detect_failures') {
    return `${policy}, limit ${scannerParams.measurement_num_detect_failures_limit}`
  }

  if (policy === 'detect_timeout') {
    return `${policy}, ${scannerParams.measurement_detect_timeout}s`
  }

  return policy
}

const formatMs = value => {
  if (value == null || Number.isNaN(value)) {
    return 'n/a'
  }

  return `${Math.round(value)} ms`
}

const formatNumber = value => {
  if (value == null || Number.isNaN(value)) {
    return 'n/a'
  }

  return Number(value).toFixed(3)
}

const formatPercent = value => {
  if (value == null || Number.isNaN(value)) {
    return 'n/a'
  }

  return `${Number(value).toFixed(1)}%`
}

const formatMetricValue = (value, unit) => {
  if (value == null || Number.isNaN(value)) {
    return 'n/a'
  }

  if (unit === 'ms') {
    return formatMs(value)
  }

  if (unit === '%') {
    return formatPercent(value)
  }

  return `${formatNumber(value)}${unit}`
}

const formatDelta = (value, unit) => {
  if (value == null || Number.isNaN(value)) {
    return 'n/a'
  }

  const sign = value > 0 ? '+' : ''
  if (unit === 'ms') {
    return `${sign}${Math.round(value)} ms`
  }

  if (unit === '%') {
    return `${sign}${Number(value).toFixed(1)}%`
  }

  return `${sign}${formatNumber(value)}${unit}`
}

const toIso = timestampMs =>
  timestampMs == null ? '' : new Date(timestampMs).toISOString()

const csvEscape = value => {
  const stringValue = String(value ?? '')
  if (
    stringValue.includes(',') ||
    stringValue.includes('"') ||
    stringValue.includes('\n')
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  return stringValue
}
