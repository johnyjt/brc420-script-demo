
const bitcoin = require('@okxweb3/coin-bitcoin');
const Brc420InscriptionTool = require('./okex-lib')
const axios = require('axios')
require('dotenv').config()

// const network = bitcoin.networks.testnet;
const network = bitcoin.networks.bitcoin;
const privateKey = process.env.PRI
const changeAddress = ''
const revealAddr = ''

const feeRate = 50;

const mintCommitTxPrevOutputList = [];
mintCommitTxPrevOutputList.push({
    txId: "",
    vOut: 9,
    amount: 121000,//
    address: "",
    privateKey: privateKey,
}, {
    txId: "",
    vOut: 2,
    amount: 38814,//
    address: "",
    privateKey: privateKey,
});

//run test
test()
async function test() {
    const txs = []
    // console.log(inscriptionResult)
    const inscriptionId = "394a02a4d9e1c2cd50f3920baa2fcc84bee3ac4cfe7431c0949765cdc510264ci0"//
    const inscriptionType = 'image/jpeg'

    const repeat = 1;//repeat time
    const royaltyReceiver = 'bc1q408xtwelejn0txlnrt0xf4wp8qg26sf5cr854m';
    const royalty = 68000;//0.00068000
    const mintResult = mint(mintCommitTxPrevOutputList, network, repeat, royaltyReceiver, royalty, inscriptionType, inscriptionId, revealAddr, changeAddress);
    txs.push(mintResult.commitTx)
    txs.push(...mintResult.revealTxs)
    await broadcast(txs);

}

function mint(commitTxPrevOutputList, network, repeat, royaltyReceiver, royalty, inscriptionType, inscriptionId, revealAddr, changeAddress) {
    const inscriptionDataList = [];
    for (let i = 0; i < repeat; i++) {
        inscriptionDataList.push({
            contentType: inscriptionType,
            body: `/content/${inscriptionId}`,
            revealAddr,
        });
    }
    const request = {
        commitTxPrevOutputList,
        commitFeeRate: feeRate,
        revealFeeRate: feeRate,
        revealOutValue: 546,
        inscriptionDataList,
        changeAddress,
    };

    const tool = Brc420InscriptionTool.newBrc420InscriptionTool(network, request, repeat, royaltyReceiver, royalty);
    // console.log(tool.commitTx.getId())
    // console.log(tool.commitTx)
    for (let i = 0; i < tool.revealTxs.length; i++) {
        const tx = tool.revealTxs[i];
        // console.log(tx)
    }

    const result = {
        commitTx: tool.commitTx.toHex(),
        revealTxs: tool.revealTxs.map(revealTx => revealTx.toHex()),
        ...tool.calculateFee(),
        commitAddrs: tool.commitAddrs,
    }
    return result;
}




async function broadcast(txs) {
    for (let i = 0; i < txs.length; i++) {
        try {
            const tx = txs[i];
            const result = await axios.post('https://mempool.space/api/tx', tx);
            console.log(result.data)
            await sleep(200);
        } catch (error) {
            console.log(error)
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}