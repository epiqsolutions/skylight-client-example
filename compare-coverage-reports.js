import fs from 'fs'
import path from 'path'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import {
  compareSummaries,
  formatComparisonMarkdown
} from './coverage-iteration.js'

const args = yargs(hideBin(process.argv))
  .usage('$0 <baseline-summary.json> <candidate-summary.json>')
  .option('output', {
    alias: 'o',
    type: 'string',
    description: 'Optional Markdown output path'
  })
  .demandCommand(2)
  .strict()
  .help()
  .parseSync()

const [baselinePath, candidatePath] = args._
const baseline = readSummary(baselinePath)
const candidate = readSummary(candidatePath)
const comparison = compareSummaries(baseline, candidate)
const markdown = formatComparisonMarkdown(comparison)

if (args.output != null) {
  const outputPath = path.resolve(args.output)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${markdown}\n`)
  console.log('Comparison report:', outputPath)
} else {
  console.log(markdown)
}

function readSummary(summaryPath) {
  return JSON.parse(fs.readFileSync(summaryPath, 'utf-8'))
}
