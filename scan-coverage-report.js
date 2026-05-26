import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'
import WebSocket from 'ws'
import argv from './args.js'
import {
  CoverageIterationTracker,
  formatIterationsCsv,
  formatMarkdownReport
} from './coverage-iteration.js'
import * as util from './util.js'

const args = argv
  .command(
    'coverage-report <survey-file>',
    './examples/example-survey-lte.json',
    yargs => {
      yargs
        .positional('survey-file', {
          type: 'string',
          description: 'Path to a survey json file',
          default: './examples/example-survey-lte.json'
        })
        .option('warmup-seconds', {
          type: 'number',
          default: 60,
          description: 'Seconds to discover the candidate cell roster'
        })
        .option('duration-seconds', {
          type: 'number',
          default: 300,
          description: 'Seconds to measure coverage iterations after warmup'
        })
        .option('output-dir', {
          type: 'string',
          default: './coverage-reports',
          description: 'Directory for JSON, CSV, and Markdown report artifacts'
        })
        .option('label', {
          type: 'string',
          description: 'Human-readable label for this run'
        })
        .option('skylight-address', {
          type: 'string',
          default: '127.0.0.1:7531',
          description: 'Skylight survey address field'
        })
        .option('leave-running', {
          type: 'boolean',
          default: false,
          description: 'Leave the started survey running after the report ends'
        })
    }
  )
  .parse('coverage-report')

const surveyFile = args['survey-file']
const surveyParams = util.loadSurveyFile(surveyFile)

if (surveyParams == null) {
  process.exit(1)
}

const survey = {
  address: args['skylight-address'],
  one_shot: false,
  rx_port: args['rx-port'],
  survey_parameters: surveyParams
}

const main = async () => {
  validatePositiveNumber(args['warmup-seconds'], 'warmup-seconds')
  validatePositiveNumber(args['duration-seconds'], 'duration-seconds')

  const config = await getConfig(args.remote)
  await runCoverageReport({
    remote: args.remote,
    rxPort: args['rx-port'],
    surveyFile,
    survey,
    config,
    warmupMs: args['warmup-seconds'] * 1000,
    measurementMs: args['duration-seconds'] * 1000,
    outputDir: args['output-dir'],
    label: args.label || defaultLabel(),
    leaveRunning: args['leave-running']
  })
}

const runCoverageReport = options => {
  return new Promise((resolve, reject) => {
    const tracker = new CoverageIterationTracker({
      config: options.config,
      warmupMs: options.warmupMs,
      measurementMs: options.measurementMs
    })
    const conn = new WebSocket(`ws://${options.remote}/events/`, ['sklt'])

    let surveyId = null
    let finishStarted = false
    let warmupTimer = null
    let finishTimer = null

    const finish = async reason => {
      if (finishStarted) {
        return
      }

      finishStarted = true
      clearTimeout(warmupTimer)
      clearTimeout(finishTimer)

      try {
        const endedAtMs = Date.now()
        tracker.finishRun(endedAtMs)

        try {
          conn.close()
        } catch (err) {
          console.error('Error closing WebSocket:', err)
        }

        if (!options.leaveRunning && surveyId != null) {
          try {
            await stopSurvey(options.remote, surveyId)
          } catch (err) {
            console.error('Error stopping survey:', err)
          }
        }

        const summary = tracker.getSummary({
          label: options.label,
          reason,
          remote: options.remote,
          rxPort: options.rxPort,
          surveyFile: options.surveyFile,
          startedAtMs: tracker.startedAtMs,
          endedAtMs
        })
        const files = writeArtifacts(options.outputDir, options.label, summary)

        console.log('Coverage report complete')
        console.log('------------------------')
        console.log('Summary JSON:', files.summaryPath)
        console.log('Iteration CSV:', files.csvPath)
        console.log('Markdown report:', files.markdownPath)

        resolve(summary)
      } catch (err) {
        reject(err)
      }
    }

    const fail = err => {
      if (finishStarted) {
        return
      }
      finishStarted = true
      clearTimeout(warmupTimer)
      clearTimeout(finishTimer)
      reject(err)
    }

    conn.on('open', async () => {
      console.log('Connected to WebSocket')
      console.log('----------------------')
      console.log(
        '\tStop Policy:\t\t',
        getScannerParam(options.config, 'measurement_stop_policy')
      )
      console.log(
        '\tFailure Limit:\t\t',
        getScannerParam(options.config, 'measurement_num_detect_failures_limit')
      )
      console.log(
        '\tFailure Timeout:\t',
        getScannerParam(options.config, 'measurement_detect_timeout')
      )

      try {
        const startedAtMs = Date.now()
        tracker.start(startedAtMs)
        const startResult = await startSurvey(options.remote, options.survey)
        surveyId = startResult?.survey_id

        warmupTimer = setTimeout(() => {
          tracker.finishWarmup(Date.now())
          console.log(
            `Candidate roster frozen with ${tracker.candidateRoster.size} cells`
          )
        }, options.warmupMs)
        finishTimer = setTimeout(() => {
          finish('duration_elapsed')
        }, options.warmupMs + options.measurementMs)
      } catch (err) {
        fail(err)
      }
    })

    conn.on('close', () => {
      if (!finishStarted) {
        fail(new Error('Disconnected from WebSocket before report completed'))
      }
    })

    conn.on('error', err => {
      fail(err)
    })

    conn.on('message', msg => {
      try {
        const parsed = JSON.parse(msg)
        if (parsed.data?.type === 'scan') {
          tracker.processScan(parsed.data.event, Date.now())
        }
      } catch (err) {
        console.error('Could not parse WebSocket message:', err)
      }
    })

    process.once('SIGINT', () => {
      console.log('\nInterrupted, writing partial coverage report')
      finish('interrupted')
    })
  })
}

const startSurvey = (remoteAddr, surveyBody) => {
  return fetch(`http://${remoteAddr}/sklt/survey/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(surveyBody)
  }).then(util.handleFetchResp)
}

const stopSurvey = (remoteAddr, surveyId) => {
  return fetch(`http://${remoteAddr}/sklt/survey/${surveyId}/state/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify('stopped')
  }).then(util.handleFetchResp)
}

const getConfig = remoteAddr => {
  return fetch(`http://${remoteAddr}/sklt/config/`).then(resp => {
    if (resp.ok) {
      return resp.json()
    }
    return Promise.reject(`${resp.status} ${resp.statusText}`)
  })
}

const writeArtifacts = (outputDir, label, summary) => {
  const fileStem = sanitizeFileStem(label)
  const resolvedDir = path.resolve(outputDir)
  fs.mkdirSync(resolvedDir, { recursive: true })

  const summaryPath = path.join(resolvedDir, `${fileStem}-summary.json`)
  const csvPath = path.join(resolvedDir, `${fileStem}-iterations.csv`)
  const markdownPath = path.join(resolvedDir, `${fileStem}-report.md`)

  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  fs.writeFileSync(csvPath, `${formatIterationsCsv(summary)}\n`)
  fs.writeFileSync(markdownPath, `${formatMarkdownReport(summary)}\n`)

  return {
    summaryPath,
    csvPath,
    markdownPath
  }
}

const getScannerParam = (config, key) =>
  config.scanner_parameters?.[key] ?? 'n/a'

const validatePositiveNumber = (value, name) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number`)
  }
}

const defaultLabel = () =>
  `coverage-${new Date().toISOString().replace(/[:.]/g, '-')}`

const sanitizeFileStem = label =>
  label
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || defaultLabel()

main().catch(err => {
  console.error(err)
  process.exit(1)
})
