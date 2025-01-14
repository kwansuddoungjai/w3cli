import fs from 'fs'
import ora, { oraPromise } from 'ora'
import { Readable } from 'stream'
import { CID } from 'multiformats/cid'
import * as DID from '@ipld/dag-ucan/did'
import * as dagJSON from '@ipld/dag-json'
import { CarWriter } from '@ipld/car'
import { filesFromPaths } from 'files-from-path'
import * as Account from './account.js'
import { spaceAccess } from '@web3-storage/w3up-client/capability/access'
import * as Space from './space.js'
import {
  getClient,
  checkPathsExist,
  filesize,
  filesizeMB,
  readProof,
  uploadListResponseToString,
  startOfLastMonth,
} from './lib.js'
import * as ucanto from '@ucanto/core'
import chalk from 'chalk'
export * as Coupon from './coupon.js'
export { Account, Space }
import ago from 's-ago'

/**
 *
 */
export async function accessClaim() {
  const client = await getClient()
  await client.capability.access.claim()
}

/**
 * @param {string} email
 */
export const getPlan = async (email = '') => {
  const client = await getClient()
  const account =
    email === ''
      ? await Space.selectAccount(client)
      : await Space.useAccount(client, { email })

  if (account) {
    const { ok: plan, error } = await account.plan.get()
    if (plan) {
      console.log(`⁂ ${plan.product}`)
    } else if (error?.name === 'PlanNotFound') {
      console.log('⁂ no plan has been selected yet')
    } else {
      console.error(`Failed to get plan - ${error.message}`)
      process.exit(1)
    }
  } else {
    process.exit(1)
  }
}

/**
 * @param {`${string}@${string}`} email
 * @param {object} [opts]
 * @param {import('@ucanto/interface').Ability[]|import('@ucanto/interface').Ability} [opts.can]
 */
export async function authorize(email, opts = {}) {
  const client = await getClient()
  const capabilities =
    opts.can != null ? [opts.can].flat().map((can) => ({ can })) : undefined
  /** @type {import('ora').Ora|undefined} */
  let spinner
  setTimeout(() => {
    spinner = ora(
      `🔗 please click the link we sent to ${email} to authorize this agent`
    ).start()
  }, 1000)
  try {
    await client.authorize(email, { capabilities })
  } catch (err) {
    if (spinner) spinner.stop()
    console.error(err)
    process.exit(1)
  }
  if (spinner) spinner.stop()
  console.log(`⁂ agent authorized to use capabilities delegated to ${email}`)
}

/**
 * @param {string} firstPath
 * @param {{
 *   _: string[],
 *   car?: boolean
 *   hidden?: boolean
 *   json?: boolean
 *   verbose?: boolean
 *   'no-wrap'?: boolean
 *   'shard-size'?: number
 *   'concurrent-requests'?: number
 * }} [opts]
 */
export async function upload(firstPath, opts) {
  const paths = checkPathsExist([firstPath, ...(opts?._ ?? [])])
  const client = await getClient()
  const hidden = !!opts?.hidden
  let totalSent = 0
  const spinner = ora({ text: 'Reading files', isSilent: opts?.json }).start()
  const files = await filesFromPaths(paths, { hidden })
  const totalSize = files.reduce((total, f) => total + f.size, 0)
  spinner.stopAndPersist({
    text: `${files.length} file${files.length === 1 ? '' : 's'} ${chalk.dim(
      filesize(totalSize)
    )}`,
  })

  if (opts?.car && files.length > 1) {
    console.error('Error: multiple CAR files not supported')
    process.exit(1)
  }

  spinner.start('Storing')
  /** @type {(o?: import('@web3-storage/w3up-client/src/types').UploadOptions) => Promise<import('@web3-storage/w3up-client/src/types').AnyLink>} */
  const uploadFn = opts?.car
    ? client.uploadCAR.bind(client, files[0])
    : files.length === 1 && opts?.['no-wrap']
      ? client.uploadFile.bind(client, files[0])
      : client.uploadDirectory.bind(client, files)

  const root = await uploadFn({
    onShardStored: ({ cid, size, piece }) => {
      totalSent += size
      if (opts?.verbose) {
        spinner.stopAndPersist({
          text: `${cid} ${chalk.dim(filesizeMB(size))}\n${chalk.dim(
            '   └── '
          )}Piece CID: ${piece}`,
        })
        spinner.start(`Storing ${Math.round((totalSent / totalSize) * 100)}%`)
      } else {
        spinner.text = `Storing ${Math.round((totalSent / totalSize) * 100)}%`
      }
      opts?.json &&
        opts?.verbose &&
        console.log(dagJSON.stringify({ shard: cid, size, piece }))
    },
    shardSize: opts?.['shard-size'] && parseInt(String(opts?.['shard-size'])),
    concurrentRequests:
      opts?.['concurrent-requests'] &&
      parseInt(String(opts?.['concurrent-requests'])),
  })
  spinner.stopAndPersist({
    symbol: '⁂',
    text: `Stored ${files.length} file${files.length === 1 ? '' : 's'}`,
  })
  console.log(
    opts?.json ? dagJSON.stringify({ root }) : `⁂ https://w3s.link/ipfs/${root}`
  )
}

/**
 * Print out all the uploads in the current space.
 *
 * @param {object} opts
 * @param {boolean} [opts.json]
 * @param {boolean} [opts.shards]
 */
export async function list(opts = {}) {
  const client = await getClient()
  let count = 0
  /** @type {import('@web3-storage/w3up-client/types').UploadListSuccess|undefined} */
  let res
  do {
    res = await client.capability.upload.list({ cursor: res?.cursor })
    if (!res) throw new Error('missing upload list response')
    count += res.results.length
    if (res.results.length) {
      console.log(uploadListResponseToString(res, opts))
    }
  } while (res.cursor && res.results.length)

  if (count === 0 && !opts.json) {
    console.log('⁂ No uploads in space')
    console.log('⁂ Try out `w3 up <path to files>` to upload some')
  }
}
/**
 * @param {string} rootCid
 * @param {object} opts
 * @param {boolean} [opts.shards]
 */
export async function remove(rootCid, opts) {
  let root
  try {
    root = CID.parse(rootCid.trim())
  } catch (/** @type {any} */ err) {
    console.error(`Error: ${rootCid} is not a CID`)
    process.exit(1)
  }
  const client = await getClient()
  let upload
  try {
    upload = await client.capability.upload.remove(root)
  } catch (/** @type {any} */ err) {
    console.error(`Remove failed: ${err.message ?? err}`)
    console.error(err)
    process.exit(1)
  }
  if (!opts.shards) {
    return
  }
  if (!upload.root) {
    return console.log(
      '⁂ upload not found. could not determine shards to remove.'
    )
  }
  if (!upload.shards || !upload.shards.length) {
    return console.log('⁂ no shards to remove.')
  }

  const { shards } = upload
  console.log(
    `⁂ removing ${shards.length} shard${shards.length === 1 ? '' : 's'}`
  )

  /** @param {import('@web3-storage/w3up-client/types').CARLink} shard */
  function removeShard(shard) {
    return oraPromise(client.capability.store.remove(shard), {
      text: `${shard}`,
      successText: `${shard} removed`,
      failText: `${shard} failed`,
    })
  }

  const results = await Promise.allSettled(shards.map(removeShard))

  if (results.some((res) => res.status === 'rejected')) {
    process.exit(1)
  }
}

/**
 * @param {string} name
 */
export async function createSpace(name) {
  const client = await getClient()
  const space = await client.createSpace(name)
  await client.setCurrentSpace(space.did())
  console.log(space.did())
}

/**
 * @param {string} proofPath
 */
export async function addSpace(proofPath) {
  const client = await getClient()
  const delegation = await readProof(proofPath)
  const space = await client.addSpace(delegation)
  console.log(space.did())
}

/**
 *
 */
export async function listSpaces() {
  const client = await getClient()
  const current = client.currentSpace()
  for (const space of client.spaces()) {
    const prefix = current && current.did() === space.did() ? '* ' : '  '
    console.log(`${prefix}${space.did()} ${space.name ?? ''}`)
  }
}

/**
 * @param {string} did
 */
export async function useSpace(did) {
  const client = await getClient()
  const spaces = client.spaces()
  const space =
    spaces.find((s) => s.did() === did) ?? spaces.find((s) => s.name === did)
  if (!space) {
    console.error(`Error: space not found: ${did}`)
    process.exit(1)
  }
  await client.setCurrentSpace(space.did())
  console.log(space.did())
}

/**
 * @param {object} opts
 * @param {import('@web3-storage/w3up-client/types').DID} [opts.space]
 * @param {string} [opts.json]
 */
export async function spaceInfo(opts) {
  const client = await getClient()
  const spaceDID = opts.space ?? client.currentSpace()?.did()
  if (!spaceDID) {
    throw new Error(
      'no current space and no space given: please use --space to specify a space or select one using "space use"'
    )
  }

  /** @type {import('@web3-storage/access/types').SpaceInfoResult} */
  let info
  try {
    info = await client.capability.space.info(spaceDID)
  } catch (/** @type {any} */ err) {
    // if the space was not known to the service then that's ok, there's just
    // no info to print about it. Don't make it look like something is wrong,
    // just print the space DID since that's all we know.
    if (err.name === 'SpaceUnknown') {
      // @ts-expect-error spaceDID should be a did:key
      info = { did: spaceDID }
    } else {
      return console.log(`Error getting info about ${spaceDID}: ${err.message}`)
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(info, null, 4))
  } else {
    const providers = info.providers?.join(', ') ?? ''
    console.log(`
      DID: ${info.did}
Providers: ${providers || chalk.dim('none')}`)
  }
}

/**
 * @param {string} audienceDID
 * @param {object} opts
 * @param {string[]|string} opts.can
 * @param {string} [opts.name]
 * @param {string} [opts.type]
 * @param {number} [opts.expiration]
 * @param {string} [opts.output]
 * @param {string} [opts.with]
 */
export async function createDelegation(audienceDID, opts) {
  const client = await getClient()

  if (client.currentSpace() == null) {
    throw new Error('no current space, use `w3 space register` to create one.')
  }
  const audience = DID.parse(audienceDID)

  const abilities = opts.can ? [opts.can].flat() : Object.keys(spaceAccess)
  if (!abilities.length) {
    console.error('Error: missing capabilities for delegation')
    process.exit(1)
  }
  const audienceMeta = {}
  if (opts.name) audienceMeta.name = opts.name
  if (opts.type) audienceMeta.type = opts.type
  const expiration = opts.expiration || Infinity

  // @ts-expect-error createDelegation should validate abilities
  const delegation = await client.createDelegation(audience, abilities, {
    expiration,
    audienceMeta,
  })

  const { writer, out } = CarWriter.create()
  const dest = opts.output ? fs.createWriteStream(opts.output) : process.stdout

  Readable.from(out).pipe(dest)

  for (const block of delegation.export()) {
    // @ts-expect-error
    await writer.put(block)
  }
  await writer.close()
}

/**
 * @param {object} opts
 * @param {boolean} [opts.json]
 */
export async function listDelegations(opts) {
  const client = await getClient()
  const delegations = client.delegations()
  if (opts.json) {
    for (const delegation of delegations) {
      console.log(
        JSON.stringify({
          cid: delegation.cid.toString(),
          audience: delegation.audience.did(),
          capabilities: delegation.capabilities.map((c) => ({
            with: c.with,
            can: c.can,
          })),
        })
      )
    }
  } else {
    for (const delegation of delegations) {
      console.log(delegation.cid.toString())
      console.log(`  audience: ${delegation.audience.did()}`)
      for (const capability of delegation.capabilities) {
        console.log(`  with: ${capability.with}`)
        console.log(`  can: ${capability.can}`)
      }
    }
  }
}

/**
 * @param {string} delegationCid
 * @param {object} opts
 * @param {string} [opts.proof]
 */
export async function revokeDelegation(delegationCid, opts) {
  const client = await getClient()
  let proof
  try {
    if (opts.proof) {
      proof = await readProof(opts.proof)
    }
  } catch (/** @type {any} */ err) {
    console.log(`Error: reading proof: ${err.message}`)
    process.exit(1)
  }
  let cid
  try {
    // TODO: we should validate that this is a UCANLink
    cid = ucanto.parseLink(delegationCid.trim())
  } catch (/** @type {any} */ err) {
    console.error(`Error: invalid CID: ${delegationCid}: ${err.message}`)
    process.exit(1)
  }
  const result = await client.revokeDelegation(
    /** @type {import('@ucanto/interface').UCANLink} */ (cid),
    { proofs: proof ? [proof] : [] }
  )
  if (result.ok) {
    console.log(`⁂ delegation ${delegationCid} revoked`)
  } else {
    console.error(`Error: revoking ${delegationCid}: ${result.error?.message}`)
    process.exit(1)
  }
}

/**
 * @param {string} proofPath
 * @param {{ json?: boolean, 'dry-run'?: boolean }} [opts]
 */
export async function addProof(proofPath, opts) {
  const client = await getClient()
  let proof
  try {
    proof = await readProof(proofPath)
    if (!opts?.['dry-run']) {
      await client.addProof(proof)
    }
  } catch (/** @type {any} */ err) {
    console.log(`Error: ${err.message}`)
    process.exit(1)
  }
  if (opts?.json) {
    console.log(JSON.stringify(proof.toJSON()))
  } else {
    console.log(proof.cid.toString())
    console.log(`  issuer: ${proof.issuer.did()}`)
    for (const capability of proof.capabilities) {
      console.log(`  with: ${capability.with}`)
      console.log(`  can: ${capability.can}`)
    }
  }
}

/**
 * @param {object} opts
 * @param {boolean} [opts.json]
 */
export async function listProofs(opts) {
  const client = await getClient()
  const proofs = client.proofs()
  if (opts.json) {
    for (const proof of proofs) {
      console.log(JSON.stringify(proof))
    }
  } else {
    for (const proof of proofs) {
      console.log(chalk.dim(`# ${proof.cid.toString()}`))
      console.log(`iss: ${chalk.cyanBright(proof.issuer.did())}`)
      if (proof.expiration !== Infinity) {
        console.log(`exp: ${chalk.yellow(proof.expiration)} ${chalk.dim(` # expires ${ago(new Date(proof.expiration * 1000))}`)}`)
      }
      console.log('att:')
      for (const capability of proof.capabilities) {
        console.log(`  - can: ${chalk.magentaBright(capability.can)}`)
        console.log(`    with: ${chalk.green(capability.with)}`)
        if (capability.nb) {
          console.log(`    nb: ${JSON.stringify(capability.nb)}`)
        }
      }
      if (proof.facts.length > 0) {
        console.log('fct:')
      }
      for (const fact of proof.facts) {
        console.log(`  - ${JSON.stringify(fact)}`)
      }
      console.log('')
    }
    console.log(chalk.dim(`# ${proofs.length} proof${proofs.length === 1 ? '' : 's'} for ${client.agent.did()}`))
  }
}

export async function whoami() {
  const client = await getClient()
  console.log(client.did())
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.human]
 * @param {boolean} [opts.json]
 */
export async function usageReport(opts) {
  const client = await getClient()
  const now = new Date()
  const period = {
    // we may not have done a snapshot for this month _yet_, so get report from last month -> now
    from: startOfLastMonth(now),
    to: now,
  }

  let total = 0
  for await (const { account, provider, space, size } of getSpaceUsageReports(
    client,
    period
  )) {
    if (opts?.json) {
      console.log(
        dagJSON.stringify({
          account,
          provider,
          space,
          size,
          reportedAt: now.toISOString(),
        })
      )
    } else {
      console.log(` Account: ${account}`)
      console.log(`Provider: ${provider}`)
      console.log(`   Space: ${space}`)
      console.log(
        `    Size: ${opts?.human ? filesize(size.final) : size.final}\n`
      )
    }
    total += size.final
  }
  if (!opts?.json) {
    console.log(`   Total: ${opts?.human ? filesize(total) : total}`)
  }
}

/**
 * @param {import('@web3-storage/w3up-client').Client} client
 * @param {{ from: Date, to: Date }} period
 */
async function* getSpaceUsageReports(client, period) {
  for (const account of Object.values(client.accounts())) {
    const subscriptions = await client.capability.subscription.list(
      account.did()
    )
    for (const { consumers } of subscriptions.results) {
      for (const space of consumers) {
        const result = await client.capability.usage.report(space, period)
        for (const [, report] of Object.entries(result)) {
          yield { account: account.did(), ...report }
        }
      }
    }
  }
}
