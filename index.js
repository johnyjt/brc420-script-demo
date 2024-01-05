
const bitcoin = require('@okxweb3/coin-bitcoin');
const Brc420InscriptionTool = require('./okex-lib')
const axios = require('axios')

const network = bitcoin.networks.testnet;
const privateKey = process.env.PRI
const changeAddress = 'tb1pcn6hl860ntwrgl6gp8h437sutrce005yc8gv7waxmaplmf9w2rzsrr69k4'
const revealAddr = 'tb1pcn6hl860ntwrgl6gp8h437sutrce005yc8gv7waxmaplmf9w2rzsrr69k4'

const feeRate = 3;

const commitTxPrevOutputList = [];
commitTxPrevOutputList.push({
    txId: "46ae1573ff8adc1d4db5906b906b07a85e7845837d0298f96bd541eb1b42c17a",
    vOut: 0,
    amount: 10000,
    address: "tb1pcn6hl860ntwrgl6gp8h437sutrce005yc8gv7waxmaplmf9w2rzsrr69k4",
    privateKey: privateKey,
});

//run test
test()
async function test() {

    const txs = []
    //1. inscription
    const inscriptionResult = ordInstription(commitTxPrevOutputList, network, 'text/plain;charset=utf-8', '`{"p":"brc-20","op":"mint","tick":"xcvb","amt":"100"}`', revealAddr, changeAddress)
    txs.push(inscriptionResult.commitTx)
    txs.push(...inscriptionResult.revealTxs)

    // console.log(inscriptionResult)
    const inscriptionId = inscriptionResult.inscriptionId

    // //2. deploy
    const deployCommitTxPrevOutputList = [];
    deployCommitTxPrevOutputList.push({ ...inscriptionResult.chargeOut, privateKey })
    const deployResult = ordInstription(deployCommitTxPrevOutputList, network, 'text/plain;charset=utf-8', `{"p":"brc-420","op":"deploy","id":"${inscriptionId}","name":"BRC-420","max":"1000","price":"0.00000420"}`, revealAddr, changeAddress)

    txs.push(deployResult.commitTx)
    txs.push(...deployResult.revealTxs)

    // console.log(deployResult)

    const mintCommitTxPrevOutputList = [];
    mintCommitTxPrevOutputList.push({ ...deployResult.chargeOut, privateKey })
    const repeat = 2;
    const royaltyReceiver = revealAddr;
    const royalty = 430;
    const mintResult = mint(mintCommitTxPrevOutputList, network, repeat, royaltyReceiver, royalty, inscriptionId, revealAddr, changeAddress);
    txs.push(mintResult.commitTx)
    txs.push(...mintResult.revealTxs)

    // console.log(txs[0])
    // console.log(txs[1])

    await broadcast(txs);
    // console.log(mintResult)
}

function ordInstription(commitTxPrevOutputList, network, contentType, body, revealAddr, changeAddress) {
    const inscriptionDataList = [];
    inscriptionDataList.push({
        contentType,
        body,
        revealAddr,
    });
    const request = {
        commitTxPrevOutputList,
        commitFeeRate: feeRate,
        revealFeeRate: feeRate,
        revealOutValue: 546,
        inscriptionDataList,
        changeAddress,
    };
    const tool = bitcoin.InscriptionTool.newInscriptionTool(network, request);
    const outLen = tool.commitTx.outs.length
    const outPut = tool.commitTx.outs[outLen - 1]

    const chargeOut = {
        txId: tool.commitTx.getId(),
        vOut: outLen - 1,
        amount: outPut.value,
        address: changeAddress,
    }

    console.log(tool.commitTx.getId())
    console.log(tool.commitTx)
    for (let i = 0; i < tool.revealTxs.length; i++) {
        const tx = tool.revealTxs[i];
        console.log(tx.getId())
        console.log(tx)
    }

    return {
        commitTx: tool.commitTx.toHex(),
        revealTxs: tool.revealTxs.map(revealTx => revealTx.toHex()),
        ...tool.calculateFee(),
        commitAddrs: tool.commitAddrs,
        inscriptionId: `${tool.revealTxs[0].getId()}i0`,
        chargeOut,
    };
}
function mint(commitTxPrevOutputList, network, repeat, royaltyReceiver, royalty, inscriptionId, revealAddr, changeAddress) {
    const inscriptionDataList = [];
    for (let i = 0; i < repeat; i++) {
        inscriptionDataList.push({
            contentType: "text/plain;charset=utf-8",
            body: `content/${inscriptionId}`,
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
    console.log(tool.commitTx.getId())
    console.log(tool.commitTx)
    for (let i = 0; i < tool.revealTxs.length; i++) {
        const tx = tool.revealTxs[i];
        console.log(tx)
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
            const result = await axios.post('https://mempool.space/testnet/api/tx', tx);
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