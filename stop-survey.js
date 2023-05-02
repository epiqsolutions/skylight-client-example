import fetch from 'node-fetch'
import argv from './args.js'

const args = argv.parse()

const findActiveSurvey = () => {
  fetch(`http://${args.remote}/sklt/survey/`)
    .then(resp => {
      if (resp.ok) {
        return resp.json()
      }
      return Promise.reject(resp)
    })
    .then(
      result => {
        const survey = result.find(survey => survey.state === 'active')

        if (survey != null) {
          const survey_id = survey.survey_id
          console.log('Found Active Survey', survey_id)
          stopSurvey(survey_id)
        } else {
          console.log('No active surveys?', result)
        }
      },
      err => {
        console.error('ERROR:', err)
      }
    )
}

const stopSurvey = survey_id => {
  fetch(`http://${args.remote}/sklt/survey/${survey_id}/state/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify('stopped')
  })
    .then(resp => {
      if (resp.ok) {
        return resp.json()
      }
      return Promise.reject(resp)
    })
    .then(
      result => {
        console.log('SURVEY Stopped', result)
      },
      err => {
        console.error('ERROR Stopping survey:', survey_id, err)
      }
    )
}

findActiveSurvey()
