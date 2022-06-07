import yargs from "yargs";

const argv = yargs(process.argv)
  .option("remote", {
    alias: "r",
    type: "string",
    description:
      "Address of remote skylight server instance to connect to, <ip>:<port>",
    default: "192.168.3.1:3030",
  })
  .option("rx-port", {
    alias: "p",
    type: "string",
    description: "Specify Rx Port to be used when starting a survey",
    default: "J3",
  })
  .help();

export default {
  parse: () => {
    const args = argv.parse();
    console.debug("Using Remote Address:", args.remote);
    return args;
  },
};
