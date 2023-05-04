import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const argv = yargs()
  .option('remote', {
    alias: 'r',
    type: 'string',
    description:
      'Address of remote skylight server instance to connect to, <ip>:<port>',
    default: '192.168.3.1:3030'
  })
  .option('rx-port', {
    alias: 'p',
    type: 'string',
    description: 'Specify Rx Port to be used when starting a survey',
    default: 'J3'
  })
  .strict()
  .help()

const proxy = {
  command: (...a) => {
    argv.command(...a)
    return proxy
  },
  parse: cmd => {
    const santized = hideBin(process.argv)
    let args

    if (cmd != null) {
      console.debug('running command:', cmd)
      args = argv.parse([cmd, ...santized])
    } else {
      args = argv.parse(santized)
    }

    console.debug('Using Remote Address:', args.remote)
    return args
  }
}

export default proxy
