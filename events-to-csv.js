import fetch from 'node-fetch'
import WebSocket from 'ws'
import argv from './args.js'

const args = argv.parse()

fetch(`http://${args.remote}/sklt/status/`)
  .then(resp => {
    if (resp.ok) {
      return resp.json()
    }
    return Promise.reject(resp)
  })
  .then(
    result => {
      // console.log(result)
      startWsConn()
    },
    err => {
      console.error('Error retrieving status:', err)
    }
)

const columns = ["band", "earfcn", "pci", "rssi", "system_date_time"]

const startWsConn = () => {
  const conn = new WebSocket(`ws://${args.remote}/events/`, ['sklt'])
  conn.on('open', () => {
    console.log(columns.join(',') + ",recv_timestamp")
  })
  conn.on('close', () => {
    exit(0)
  })
  conn.on('message', msg => {
    const evt = JSON.parse(msg)
    if (evt.data?.type === 'scan') {
      const ts = Date.now()
      const values = columns.map(col => evt.data.event[col])
      const line = values.join(',') + ',' + ts
      console.log(line)
    }
  })
}