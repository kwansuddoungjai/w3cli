#!/usr/bin/env node

import sade from 'sade'
import open from 'open'
import updateNotifier from 'update-notifier'
import { getPkg } from './lib.js'
import {
  Account,
  Space,
  Coupon,
  accessClaim,
  addSpace,
  listSpaces,
  useSpace,
  spaceInfo,
  createDelegation,
  listDelegations,
  revokeDelegation,
  addProof,
  listProofs,
  upload,
  remove,
  list,
  whoami,
  usageReport,
  getPlan,
} from './index.js'
import {
  storeAdd,
  storeList,
  storeRemove,
  uploadAdd,
  uploadList,
  uploadRemove,
  filecoinInfo,
} from './can.js'

const pkg = getPkg()

updateNotifier({ pkg }).notify()

const cli = sade('w3')

cli
  .version(pkg.version)
  .example('login user@example.com')
  .example('up path/to/files')

cli
  .command('login <email>')
  .example('login user@example.com')
  .describe(
    'Authenticate this agent with your email address to gain access to all capabilities that have been delegated to it.'
  )
  .action(Account.login)

cli
  .command('plan get [email]')
  .example('plan get user@example.com')
  .describe('Displays plan given account is on')
  .action(getPlan)

cli
  .command('account ls')
  .alias('account list')
  .describe('List accounts this agent has been authorized to act on behalf of.')
  .action(Account.list)

cli
  .command('up <file>')
  .alias('upload', 'put')
  .describe('Store a file(s) to the service and register an upload.')
  .option('--no-wrap', "Don't wrap input files with a directory.", false)
  .option('-H, --hidden', 'Include paths that start with ".".')
  .option('-c, --car', 'File is a CAR file.', false)
  .option('--json', 'Format as newline delimited JSON')
  .option('--verbose', 'Output more details.')
  .option(
    '--shard-size',
    'Shard uploads into CAR files of approximately this size in bytes.'
  )
  .option(
    '--concurrent-requests',
    'Send up to this many CAR shards concurrently.'
  )
  .action(upload)

cli
  .command('open <cid>')
  .describe('Open CID on https://w3s.link')
  .action((cid) => open(`https://w3s.link/ipfs/${cid}`))

cli
  .command('ls')
  .alias('list')
  .describe('List uploads in the current space')
  .option('--json', 'Format as newline delimited JSON')
  .option('--shards', 'Pretty print with shards in output')
  .action(list)

cli
  .command('rm <root-cid>')
  .example('rm bafy...')
  .describe(
    'Remove an upload from the uploads listing. Pass --shards to delete the actual data if you are sure no other uploads need them'
  )
  .option(
    '--shards',
    'Remove all shards referenced by the upload from the store. Use with caution and ensure other uploads do not reference the same shards.'
  )
  .action(remove)

cli
  .command('whoami')
  .describe('Print information about the current agent.')
  .action(whoami)

cli
  .command('space create [name]')
  .describe('Create a new w3 space')
  .option('-nr, --no-recovery', 'Skips recovery key setup')
  .option('-n, --no-caution', 'Prints out recovery key without confirmation')
  .option('-nc, --no-customer', 'Skip billing setup')
  .option('-c, --customer <email>', 'Billing account email')
  .option('-na, --no-account', 'Skip account setup')
  .option('-a, --account <email>', 'Managing account email')
  .action(Space.create)

cli
  .command('space provision [name]')
  .describe('Associating space with a billing account')
  .option('-c, --customer', 'The email address of the billing account')
  .option('--coupon', 'Coupon URL to provision space with')
  .option('-p, -password', 'Coupon password')
  .option(
    '-p, --provider',
    'The storage provider to associate with this space.'
  )
  .action(Space.provision)

cli
  .command('space add <proof>')
  .describe(
    'Add a space to the agent. The proof is a CAR encoded delegation to _this_ agent.'
  )
  .action(addSpace)

cli
  .command('space ls')
  .describe('List spaces known to the agent')
  .action(listSpaces)

cli
  .command('space info')
  .describe('Show information about a space. Defaults to the current space.')
  .option('-s, --space', 'The space to print information about.')
  .option('--json', 'Format as newline delimited JSON')
  .action(spaceInfo)

cli
  .command('space use <did>')
  .describe('Set the current space in use by the agent')
  .action(useSpace)

cli
  .command('coupon create <did>')
  .option('--password', 'Password for created coupon.')
  .option('-c, --can', 'One or more abilities to delegate.')
  .option(
    '-e, --expiration',
    'Unix timestamp when the delegation is no longer valid. Zero indicates no expiration.',
    0
  )
  .option(
    '-o, --output',
    'Path of file to write the exported delegation data to.'
  )
  .action(Coupon.issue)

cli
  .command('delegation create <audience-did>')
  .describe(
    'Create a delegation to the passed audience for the given abilities with the _current_ space as the resource.'
  )
  .option('-c, --can', 'One or more abilities to delegate.')
  .option(
    '-n, --name',
    'Human readable name for the audience receiving the delegation.'
  )
  .option(
    '-t, --type',
    'Type of the audience receiving the delegation, one of: device, app, service.'
  )
  .option(
    '-e, --expiration',
    'Unix timestamp when the delegation is no longer valid. Zero indicates no expiration.',
    0
  )
  .option(
    '-o, --output',
    'Path of file to write the exported delegation data to.'
  )
  .action(createDelegation)

cli
  .command('delegation ls')
  .describe('List delegations created by this agent for others.')
  .option('--json', 'Format as newline delimited JSON')
  .action(listDelegations)

cli
  .command('delegation revoke <delegation-cid>')
  .describe('Revoke a delegation by CID.')
  .option(
    '-p, --proof',
    'Name of a file containing the delegation and any additional proofs needed to prove authority to revoke'
  )
  .action(revokeDelegation)

cli
  .command('proof add <proof>')
  .describe('Add a proof delegated to this agent.')
  .option('--json', 'Format as newline delimited JSON')
  .option('--dry-run', 'Decode and view the proof but do not add it')
  .action(addProof)

cli
  .command('proof ls')
  .describe('List proofs of capabilities delegated to this agent.')
  .option('--json', 'Format as newline delimited JSON')
  .action(listProofs)

cli
  .command('usage report')
  .describe('Display report of current space usage in bytes.')
  .option('--human', 'Format human readable values.', false)
  .option('--json', 'Format as newline delimited JSON', false)
  .action(usageReport)

cli
  .command('can access claim')
  .describe('Claim delegated capabilities for the authorized account.')
  .action(accessClaim)

cli
  .command('can store add <car-path>')
  .describe('Store a CAR file with the service.')
  .action(storeAdd)

cli
  .command('can store ls')
  .describe('List CAR files in the current space.')
  .option('--json', 'Format as newline delimited JSON')
  .option('--size', 'The desired number of results to return')
  .option(
    '--cursor',
    'An opaque string included in a prior store/list response that allows the service to provide the next "page" of results'
  )
  .option('--pre', 'If true, return the page of results preceding the cursor')
  .action(storeList)

cli
  .command('can store rm <shard-cid>')
  .describe('Remove a CAR shard from the store.')
  .action(storeRemove)

cli
  .command('can upload add <root-cid> <shard-cid>')
  .describe(
    'Register an upload - a DAG with the given root data CID that is stored in the given CAR shard(s), identified by CAR CIDs.'
  )
  .action(uploadAdd)

cli
  .command('can upload ls')
  .describe('List uploads in the current space.')
  .option('--json', 'Format as newline delimited JSON')
  .option('--shards', 'Pretty print with shards in output')
  .option('--size', 'The desired number of results to return')
  .option(
    '--cursor',
    'An opaque string included in a prior upload/list response that allows the service to provide the next "page" of results'
  )
  .option('--pre', 'If true, return the page of results preceding the cursor')
  .action(uploadList)

cli
  .command('can upload rm <root-cid>')
  .describe('Remove an upload from the uploads listing.')
  .action(uploadRemove)

cli
  .command('can filecoin info <piece-cid>')
  .describe('Get filecoin information for given PieceCid.')
  .action(filecoinInfo)

// show help text if no command provided
cli.command('help [cmd]', 'Show help text', { default: true }).action((cmd) => {
  try {
    cli.help(cmd)
  } catch (err) {
    console.log(`
ERROR
  Invalid command: ${cmd}
  
Run \`$ w3 --help\` for more info.
`)
    process.exit(1)
  }
})

cli.parse(process.argv)
