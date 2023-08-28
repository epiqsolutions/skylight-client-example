import fetch from 'node-fetch'
import fs from 'fs'
import WebSocket from 'ws'
import argv from './args.js'
import * as util from './util.js'

const args = argv
  .command('config-patch <configFilePath>', './path-to-file.json', yargs => {
    yargs.positional('configFilePath', {
      type: 'string',
      description: 'script specific argument'
    })
  })
  .parse('config-patch')

const patchConfig = (remoteAddr, patchObj) => {
  return fetch(`http://${remoteAddr}/sklt/config/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patchObj)
  })
}

if (args.configFilePath == null) {
  console.error('please provide a path to a config patch JSON file')
  process.exit(1)
}

let patchObj
try {
  const jsonString = fs.readFileSync(args.configFilePath, 'utf-8')
  patchObj = JSON.parse(jsonString)
} catch (error) {
  console.error('Error reading JSON file:', error)
  process.exit(1)
}

patchConfig(args.remote, patchObj).then(
  resp => {
    resp.json().then(
      respBody => {
        console.log('Response:', respBody)
        if (resp.ok) {
          process.exit(0)
        }
        process.exit(1)
      },
      err => {
        console.log('Could not parse response', err)
        process.exit(1)
      }
    )
  },
  err => {
    console.log('Request failed', err)
    process.exit(1)
  }
)
