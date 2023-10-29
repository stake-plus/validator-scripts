const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const fs = require('fs');

async function main() {
  const rawdata = fs.readFileSync('config.json');
  const config = JSON.parse(rawdata);
  const keyring = new Keyring({ type: 'sr25519' });

  for (const network of config.networks) {
    const wsProvider = new WsProvider(network.endpoint);
    const api = await ApiPromise.create({ provider: wsProvider });
    const pair = keyring.addFromUri(config.wallets.find(w => w.network === network.name).seedPhrase);
    const currentEra = await api.query.staking.currentEra();
    const currentEraNumber = currentEra.unwrap().toNumber();
    const checkEras = Array.from({ length: 4 }, (_, i) => currentEraNumber - i - 1);

    for (const stash of network.stashAccounts) {
      const stakingLedger = await api.query.staking.ledger(stash);

      if (!stakingLedger || !stakingLedger.isSome) {
        console.log(`No staking ledger found for ${stash}`);
        continue;
      }

      const ledger = stakingLedger.unwrap();
      const claimedEras = ledger.claimedRewards.map((era) => era.toNumber());

      for (const era of checkEras) {
        const stakers = await api.query.staking.erasStakers(era, stash);
        if (stakers.isEmpty) {
          console.log(`Stash ${stash} was not active in era ${era}`);
          continue;
        }

        if (claimedEras.includes(era)) {
          console.log(`Era ${era} for stash ${stash} has been claimed`);
        } else {
          console.log(`Unclaimed rewards found for stash ${stash} in era ${era}`);

          // Create transaction
          const tx = api.tx.staking.payoutStakers(stash, era);

          // Send the transaction and wait for it to be finalized
          const promise = new Promise((resolve, reject) => {
            tx.signAndSend(pair, async ({ status, dispatchError }) => {
              if (dispatchError) {
                reject(new Error(dispatchError.toString()));
              }
              if (status.isFinalized) {
                resolve(`Payout for era ${era} and stash ${stash} finalized with hash ${status.asFinalized}`);
              }
            });
          });

          try {
            const msg = await promise;
            console.log(msg);
          } catch (error) {
            console.log(`Failed to send transaction for era ${era} and stash ${stash}: ${error.message}`);
          }
        }
      }
    }
    await wsProvider.disconnect();
  }
}

main().catch(console.error);
