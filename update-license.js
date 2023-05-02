import fetch from 'node-fetch'
import WebSocket from 'ws'
import { FormData } from 'formdata-polyfill/esm.min.js'
import { File } from 'fetch-blob/file.js'
import { fileFromSync } from 'fetch-blob/from.js'
import argv from './args.js'
import fs from 'fs'

const args = argv.parse()

if (args._.length < 1) {
  console.error('Must pass a path to a license file')
  process.exit(1)
}

if (!fs.existsSync(args._[0])) {
  console.error('File does not exist', args._[0])
  process.exit(1)
}

const file = fileFromSync(args._[0], 'text/plain')

const formData = new FormData()
formData.set('file', file)

const skltAddr = args.remote.replace('3030', '7531')
const metadata = { 'skylight-address': skltAddr }
formData.set('metadata', JSON.stringify(metadata))

fetch(`http://${args.remote}/sklt/license/`, {
  method: 'POST',
  body: formData
})
  .then(resp => {
    if (resp.ok) {
      return resp.json()
    }
    return Promise.reject(resp)
  })
  .then(
    result => {
      console.log('license updated', result)
    },
    err => {
      console.error('ERROR:', err)
    }
  )
