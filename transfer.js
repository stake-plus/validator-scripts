const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');
const fs = require('fs');
const BN = require('bn.js');

async function main() {
    const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));

    for (const network of config.networks) {
        const wsProvider = new WsProvider(network.endpoint);
        const api = await ApiPromise.create({ provider: wsProvider });

        const decimals = api.registry.chainDecimals[0];
        const thresholdString = (network.thresholdAmount * Math.pow(10, decimals)).toFixed(0);
        const thresholdBN = new BN(thresholdString);

        for (const wallet of config.wallets) {
            if (wallet.network !== network.name) {
                continue;
            }

            const keyring = new Keyring({ type: 'sr25519' });
            const pair = keyring.addFromUri(wallet.seedPhrase);
            const accountInfo = await api.query.system.account(pair.address);
            const stakingInfo = await api.query.staking.ledger(pair.address);

            let lockedBalance = new BN(0);
            if (stakingInfo && stakingInfo.isSome) {
                lockedBalance = new BN(stakingInfo.unwrap().active.toString());
            }

            console.log(`Free Balance: ${accountInfo.data.free.toString()}, Reserved Balance: ${accountInfo.data.reserved.toString()}, Locked Balance: ${lockedBalance.toString()}`);

            // Ensure that the locked balance doesn't exceed the free balance
            if (lockedBalance.gte(accountInfo.data.free)) {
                console.log(`Skipped sending from ${pair.address} due to locked balance exceeding free balance.`);
                continue;
            }

            let transferableBalance = accountInfo.data.free.sub(accountInfo.data.reserved).sub(lockedBalance);

            console.log(`Wallet ${pair.address} Transferable Balance: ${transferableBalance.toString()}, Threshold: ${thresholdBN.toString()}`);

            if (transferableBalance.isZero()) {
                console.log(`Skipped sending from ${pair.address} due to zero transferable balance.`);
                continue;
            }

            if (transferableBalance.gtn(thresholdBN)) {
                const amountToSend = transferableBalance.sub(thresholdBN);

                if (amountToSend.gtn(new BN(0))) {
                    const transfer = api.tx.balances.transfer(network.destinationAddress, amountToSend);

                    const txHash = await transfer.signAndSend(pair);
                    console.log(`Sent ${amountToSend.toString()} from ${pair.address} to ${network.destinationAddress}. TxHash: ${txHash.toString()}`);
                } else {
                    console.log(`Skipped sending from ${pair.address} due to calculated negative AmountToSend.`);
                }
            } else {
                console.log(`Skipped sending from ${pair.address} as transferable balance is below threshold.`);
            }
        }

        await wsProvider.disconnect();
    }
}

main().catch(console.error);
