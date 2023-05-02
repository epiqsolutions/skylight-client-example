import fetch from 'node-fetch'
import readline from 'readline'
import WebSocket from 'ws'
import argv from './args.js'
import * as util from './util.js'

const args = argv.parse()

const start = (remoteAddr, survey) => {
  return fetch(`http://${remoteAddr}/sklt/survey/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(survey)
  }).then(util.handleFetchResp)
}

const rxPort = args['rx-port']
const surveyFile = args['survey-file']
const surveyParams = util.loadSurveyFile(surveyFile)

if (surveyParams == null) {
  process.exit(1)
}

const openConn = () => {
  // keep a collection of known PCIs
  const knownCellDict = {}
  let phyIteration = 0
  let cellsNotSeenThisPhyIter = {}
  let cellCount = 0
  let countDown = 0
  let cellId
  let startTime = Date.now()
  let lastPhyIterationComplete = startTime

  const conn = new WebSocket(`ws://${args.remote}/events/`, ['sklt'])
  conn.on('open', () => {
    console.log('CONNECTED TO WS')
    // make space for stats
    console.log('\n\n\n\n\n\n\n')
  })
  conn.on('close', () => {
    console.error('Disconnected from WS')
  })
  conn.on('message', msg => {
    const {
      data: { event, type }
    } = JSON.parse(msg)

    if (type == 'scan') {
      // create a key for the PCI reported in this scan event
      cellId = `${event.tech}-${event.pci}-${event.frequency_mhz}`

      // add cell to known list and count
      if (knownCellDict[cellId] == null) {
        knownCellDict[cellId] = true
        // it has been seen this iter (just now)
        cellsNotSeenThisPhyIter[cellId] = false
        cellCount += 1
      }

      // if this cell hasn't been seen on this pass, yet, mark it and decrement
      // the counter
      if (cellsNotSeenThisPhyIter[cellId] === true) {
        cellsNotSeenThisPhyIter[cellId] = false
        countDown -= 1
      }

      // if all cells have been seen, restart the countdown
      if (cellCount > 0 && countDown === 0) {
        const lapTime = Date.now()
        const avgLap = Math.round((lapTime - startTime) / (phyIteration + 1))
        reprint(
          'Phy Iteration Monitor',
          '---------------------',
          `\titeration:\t\t${phyIteration}`,
          `\tcells found:\t\t${cellCount}`,
          `\titeration time (last):\t${lapTime - lastPhyIterationComplete} ms`,
          `\titeration time (avg):\t${avgLap} ms`,
          `\tscan_iteration:\t\t${event.scan_iteration}`
        )
        countDown = cellCount
        cellsNotSeenThisPhyIter = { ...knownCellDict }
        lastPhyIterationComplete = lapTime
        phyIteration += 1
      }
    }
  })
}

const reprint = (...lines) => {
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
  () => openConn(),
  () => process.exit(1)
)
