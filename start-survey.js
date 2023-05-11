import fetch from 'node-fetch'
import WebSocket from 'ws'
import argv from './args.js'
import * as util from './util.js'

const args = argv.parse('start-survey')

const rxPort = args['rx-port']
const surveyFile = args['survey-file']
const surveyParams = util.loadSurveyFile(surveyFile)

const survey = {
  address: '127.0.0.1:7531',
  one_shot: false,
  rx_port: rxPort,
  survey_parameters: surveyParams
}

const startSurvey = (remoteAddr, survey) => {
  return fetch(`http://${remoteAddr}/sklt/survey/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(survey)
  }).then(util.handleFetchResp)
}

startSurvey(args.remote, survey).then(
  result => {
    process.exit(0)
  },
  err => {
    process.exit(1)
  }
)
