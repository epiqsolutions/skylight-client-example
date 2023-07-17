import fetch from 'node-fetch'
import readline from 'readline'
import WebSocket from 'ws'
import argv from './args.js'
import * as util from './util.js'

const args = argv.parse('start-survey')

const start = (remoteAddr, survey) => {
  return fetch(`http://${remoteAddr}/sklt/survey/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(survey)
  })
    .then(util.handleFetchResp)
    .then(() => {
      return fetch(`http://${remoteAddr}/sklt/config/`).then(resp => {
        if (resp.ok) {
          return resp.json()
        }
        return Promise.reject(`${resp.status} ${resp.statusText}`)
      })
    })
}

const rxPort = args['rx-port']
const surveyFile = args['survey-file']
const surveyParams = util.loadSurveyFile(surveyFile)

if (surveyParams == null) {
  process.exit(1)
}

const openConn = config => {
  // keep a collection of known PCIs
  const knownCellDict = {}
  const {
    scanner_parameters: {
      measurement_stop_policy,
      measurement_num_detect_failures_limit,
      measurement_detect_timeout
    }
  } = config
  let phyIteration = 0
  let cellsNotSeenThisPhyIter = {}
  let cellCount = 0
  let countDown = 0
  let scanCount = 0
  let cellId
  let startTime = Date.now()
  let lastPhyIterationComplete = startTime

  const conn = new WebSocket(`ws://${args.remote}/events/`, ['sklt'])
  conn.on('open', () => {
    console.log('Connected to WebSocket')
    console.log('----------------------')
    console.log('\tStop Policy:\t\t', measurement_stop_policy)
    console.log('\tFailure Limit:\t\t', measurement_num_detect_failures_limit)
    console.log('\tFailure Timeout:\t', measurement_detect_timeout)
  })

  conn.on('close', () => {
    console.error('Disconnected from WS')
  })

  conn.on('message', msg => {
    const {
      data: { event, type }
    } = JSON.parse(msg)

    if (type == 'scan') {
      scanCount += 1
      // create a key for the PCI reported in this scan event
      cellId = `${event.tech}-${event.pci}-${event.frequency_mhz}`

      // add cell to known list and count
      if (knownCellDict[cellId] == null && event.mib != null) {
        // this assumes that the first time we see a cell, it was decoded
        knownCellDict[cellId] = refreshCell(event)
        cellCount += 1
      } else if (event.mib != null) {
        // if the cell was already known and this is a decode event, update the
        // decode time and iteration marker for this cell
        knownCellDict[cellId] = refreshCell(event)
      }

      // if this cell hasn't been seen on this pass, yet, mark it and decrement
      // the counter
      if (cellsNotSeenThisPhyIter[cellId] === true) {
        delete cellsNotSeenThisPhyIter[cellId]
        countDown -= 1
      } else if (countDown > 0) {
        // if we're seeing cells that we've already seen on this pass, but we're
        // still waiting on others, verify that the remaining cells haven't
        // satisfied the measurement stop policy
        for (let id in cellsNotSeenThisPhyIter) {
          const isStale = checkIfCellIsStale(
            knownCellDict[id],
            event.scan_iteration,
            measurement_stop_policy,
            measurement_num_detect_failures_limit,
            measurement_detect_timeout
          )
          // if this cell that we're waiting for has become stale, remove it
          // from the known cells list and decrement the count down
          if (isStale) {
            delete knownCellDict[id]
            delete cellsNotSeenThisPhyIter[id]
            cellCount -= 1
            countDown -= 1
          }
        }
      }

      // if all cells have been seen, restart the countdown
      if (cellCount > 0 && countDown === 0) {
        const lapTime = Date.now()
        const timeSpan = lapTime - startTime
        const avgLap = Math.round(timeSpan / (phyIteration + 1))
        reprint(
          'Phy Iteration Monitor',
          '---------------------',
          `\titeration:\t\t${phyIteration}`,
          `\tcells:\t\t\t${cellCount}`,
          `\titeration time (last):\t${lapTime - lastPhyIterationComplete} ms`,
          `\titeration time (avg):\t${avgLap} ms`,
          `\tscan_iteration:\t\t${event.scan_iteration}`,
          `\traw scans:\t\t${(scanCount / timeSpan) * 1000}/s`
        )
        countDown = cellCount
        cellsNotSeenThisPhyIter = resetAllNotSeen(knownCellDict)
        lastPhyIterationComplete = lapTime
        phyIteration += 1
      }
    }
  })
}

const refreshCell = event => ({
  decodeIteration: event.scan_iteration,
  decodeTime: Date.now()
})

const resetAllNotSeen = knownCellDict =>
  Object.keys(knownCellDict).reduce(
    (newState, cellId) => ({
      ...newState,
      [cellId]: true
    }),
    {}
  )

const checkIfCellIsStale = (
  cellInfo,
  scan_iteration,
  policy,
  failLimit,
  timeoutSeconds
) => {
  switch (policy) {
    case 'num_detect_failures':
      return scan_iteration - cellInfo.decodeIteration >= failLimit

    case 'detect_timeout':
      // get the number of milliseconds that have lapsed since this cell's last
      // decode and check if it is greater than the configured threshold
      return (Date.now() - cellInfo.decodeTime) / 1000 >= timeoutSeconds
  }
}

const print = (printer, ...args) => {
  printer(...args)
  resetPrintSpace = true
}

let resetPrintSpace = true
const reprint = (...lines) => {
  // add space for stats, so we don't overwrite other stuff
  if (resetPrintSpace) {
    console.log('\n\n\n\n\n\n\n')
    resetPrintSpace = false
  }

  // Move the cursor up by the number of lines
  readline.moveCursor(process.stdout, 0, -lines.length)

  // Clear the current line and print the new lines
  for (const line of lines) {
    readline.clearLine(process.stdout, 0)
    readline.cursorTo(process.stdout, 0)
    console.log(line)
  }
}

const survey = {
  address: '127.0.0.1:7531',
  one_shot: false,
  rx_port: rxPort,
  survey_parameters: surveyParams
}

start(args.remote, survey).then(
  config => openConn(config),
  err => {
    console.error(err)
    process.exit(1)
  }
)
