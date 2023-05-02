import fetch from 'node-fetch'
import WebSocket from 'ws'
import argv from './args.js'

const args = argv.parse()

const getStatus = () => {
  fetch(`http://${args.remote}/sklt/status/`)
    .then(resp => {
      if (resp.ok) {
        return resp.json()
      }
      return Promise.reject(resp)
    })
    .then(
      result => {
        console.log('Status', result)
        startWsConn()
      },
      err => {
        console.error('Error retrieving status:', err)
      }
    )
}

getStatus()

const startWsConn = () => {
  const conn = new WebSocket(`ws://${args.remote}/events/`, ['sklt'])
  conn.on('open', () => {
    console.log('CONNECTED to WS')
  })
  conn.on('close', () => {
    console.error('DISCONNECTED from WS')
  })
  conn.on('message', msg => {
    console.log('MSG: %s', msg)
  })
}
