import fetch from 'node-fetch'
import fs from 'fs'
import WebSocket from 'ws'
import argv from './args.js'
import * as util from './util.js'

const args = argv.parse()

const patchConfig = (remoteAddr, patchObj) => {
  return fetch(`http://${remoteAddr}/sklt/config/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patchObj)
  })
}

if (args._.length != 1) {
  console.error('please provide a path to a config patch JSON file')
  process.exit(1)
}

let patchObj
try {
  const jsonString = fs.readFileSync(args._[0], 'utf-8')
  patchObj = JSON.parse(jsonString)
} catch (error) {
  console.error('Error reading JSON file:', error)
  process.exit(1)
}

patchConfig(args.remote, patchObj).then(
  () => process.exit(0),
  err => {
    console.log('WTF', err)
    process.exit(1)
  }
)
