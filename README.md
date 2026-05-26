# Skylight Client Example Scripts

This repo contains JavaScript example client code for the [Skylight HTTP API](https://api.epiq.solutions/skylight/v0.3.0/).

## Basics

When using a stock PRiSM device, the default API URL is the following:

```
http://192.168.3.1:3030/sklt/
```

For example, to get the device's [status summary](https://api.epiq.solutions/skylight/v0.3.0/#tag/Skylight/paths/~1status~1/get), you can enter the following URL in your web browser's address bar

```
http://192.168.3.1:3030/sklt/status/
```

## Run a script

This repo contains executable scripts that provide examples for performing various operations via the API. To run them, you must first install [Node.js](https://nodejs.org/)

### Install dependencies

```
npm install
```

### Example - Start a Survey

Example:

```
node start-survey.js --remote 192.168.3.1:3030 --rx-port J3 ./examples/example-survey-lte.json
```

> **NOTE**: `192.168.3.1:3030` is the default `remote` address and `J3` is the default `rx-port`, so these options can technically be omitted on a stock setup.

### --help

run `node <script-name> --help` to get info about arguments for each script

## Coverage Iteration Speed Reports

`scan-coverage-report.js` measures scan speed as normalized coverage time: the
milliseconds required per active cell in a coverage iteration. A coverage
iteration is complete when at least one scan measurement has been received for
every currently active detected cell. It warms up first to discover a comparison
roster, then keeps an operational roster in sync with Skylight's configured
measurement stop policy.

Cells discovered after warmup are included in the operational roster and called
out separately as late-discovered workload. This keeps the headline metric from
pretending the scanner is only spending time on the warmup roster.

Example:

```
node scan-coverage-report.js --remote 192.168.3.1:3030 --rx-port J3 --label old-release ./examples/example-survey-lte.json
```

The script writes a JSON summary, an iteration CSV, and a Markdown report under
`coverage-reports/` by default.

To compare two report summaries:

```
node compare-coverage-reports.js coverage-reports/old-release-summary.json coverage-reports/new-release-summary.json
```
