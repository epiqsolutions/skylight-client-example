import fs from 'fs'

export const handleFetchResp = resp => {
  return parseResponseOrFail(resp).then(
    // print and return success response
    result => {
      printFetchSuccess(resp, result)
      return Promise.resolve(result)
    },
    // handle error response or failure to decode success response
    err => {
      return err.text().then(
        errBody => {
          printFetchError(resp, errBody)
          return Promise.reject(errBody)
        },
        () => {
          printFetchError(resp, 'Could not decode response body')
          return Promise.reject('Unknown Error')
        }
      )
    }
  )
}

const parseResponseOrFail = resp => {
  if (resp.ok) {
    return resp.json()
  }
  return Promise.reject(resp)
}

const printFetchResult = printer => (resp, body) => {
  printer(
    'Server responsed with:',
    '\n\tcode:',
    resp.status,
    '-',
    resp.statusText,
    '\n\tresponse:\n\n',
    JSON.stringify(body, null, 2),
    '\n\n----\n'
  )
}
const printFetchSuccess = printFetchResult(console.info)
const printFetchError = printFetchResult(console.error)

export const loadSurveyFile = filePath => {
  try {
    const jsonString = fs.readFileSync(filePath, 'utf-8')
    const surveyParams = JSON.parse(jsonString)
    if (Array.isArray(surveyParams)) {
      return surveyParams
    } else {
      console.error('Expected an array at the top level')
    }
  } catch (error) {
    console.error('Error reading JSON file:', error)
  }
}

export const circularBuffer = size => {
  let length = 0
  const buffer = new Array(size)
  let index = 0
  return {
    push: (timestamp, currentScanCount) => {
      buffer[index] = { timestamp, currentScanCount }
      index = (index + 1) % size
      length = Math.min(length + 1, size)
    },
    getOldest: () => (length < size ? buffer[0] : buffer[index]),
    getLength: () => length
  }
}
