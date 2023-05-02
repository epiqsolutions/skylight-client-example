import fetch from 'node-fetch'
import WebSocket from 'ws'
import argv from './args.js'
import * as util from './util.js'

const args = argv.parse()

const startSurvey = (remoteAddr, survey) => {
  return fetch(`http://${remoteAddr}/sklt/survey/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(survey)
  }).then(util.handleFetchResp)
}

const lteSurvey = {
  address: '127.0.0.1:7531',
  one_shot: false,
  rx_port: args['rx-port'],
  survey_parameters: [
    {
      tech: 'lte',
      type: 'band',
      bands: [{ band: '2', channels: ['70', '850', '975'] }]
    }
    //{
    //tech: "nr",
    //type: "band",
    //bands: [
    //{ band: "5", channels: [] },
    //{ band: "71", channels: [] }
    //]
    //}
    //{
    //tech: "lte",
    //type: "band",
    //bands: [
    //{ band: "2", channels: ['700','850','1050'] },
    //{ band: "4", channels: ['2050','2300'] },
    //{ band: "5", channels: ["2560"] },
    //{ band: "12", channels: ["5035","5110"] },
    //{ band: "13", channels: ["5230"] },
    //{ band: "17", channels: ["5780"] }
    //{ band: "2", channels: [] },
    //{ band: "4", channels: [] },
    //{ band: "5", channels: [] },
    //{ band: "12", channels: [] },
    //{ band: "13", channels: [] },
    //{ band: "17", channels: [] }
    //],
    //},
    // {
    //   tech: "p25",
    //   type: "frequency-list",
    //   frequencies_hz: [851537500, 852337500],
    // },
  ]
}

startSurvey(args.remote, lteSurvey).then(
  result => {
    prosess.exit(0)
  },
  err => {
    process.exit(1)
  }
)
