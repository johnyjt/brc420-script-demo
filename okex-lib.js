
const bitcoin = require('@okxweb3/coin-bitcoin');
const { base, signUtil } = require('@okxweb3/crypto-lib');
const secp256k1 = signUtil.schnorr.secp256k1
const schnorr = secp256k1.schnorr
const ProjPoint = secp256k1.secp256k1.ProjectivePoint
const CURVE_ORDER = secp256k1.secp256k1.CURVE.n;

const defaultTxVersion = 2;
const defaultSequenceNum = 0xfffffffd;
const defaultRevealOutValue = 546;
const defaultMinChangeValue = 546;

class Brc420InscriptionTool extends bitcoin.InscriptionTool {
    constructor() {
        super();  // 调用父类的构造函数
    }

    static newBrc420InscriptionTool(network, request, repeat, royaltyReceiver, royalty) {
        const tool = new Brc420InscriptionTool();
        tool.network = network;
        tool.repeat = repeat;
        tool.royalty = royalty;
        tool.royaltyReceiver = royaltyReceiver;

        const revealOutValue = request.revealOutValue || defaultRevealOutValue;
        const minChangeValue = request.minChangeValue || defaultMinChangeValue;

        // console.log(revealOutValue, minChangeValue)
        // TODO: use commitTx first input privateKey
        const privateKey = request.commitTxPrevOutputList[0].privateKey;
        request.inscriptionDataList.forEach(inscriptionData => {
            tool.inscriptionTxCtxDataList.push(createInscriptionTxCtxData(network, inscriptionData, privateKey));
        });

        const totalRevealPrevOutputValue = tool.buildEmptyRevealTx(network, revealOutValue, request.revealFeeRate);
        const insufficient = tool.buildCommitTx(network, request.commitTxPrevOutputList, request.changeAddress, totalRevealPrevOutputValue, request.commitFeeRate, minChangeValue);
        if (insufficient) {
            return tool;
        }
        tool.signCommitTx(request.commitTxPrevOutputList);
        tool.completeRevealTx();
        return tool;
    }

    buildCommitTx(network, commitTxPrevOutputList, changeAddress, totalRevealPrevOutputValue, commitFeeRate, minChangeValue) {
        let totalSenderAmount = 0;
        const tx = new bitcoin.Transaction();
        tx.version = super.defaultTxVersion;

        commitTxPrevOutputList.forEach(commitTxPrevOutput => {
            const hash = base.reverseBuffer(base.fromHex(commitTxPrevOutput.txId));
            tx.addInput(hash, commitTxPrevOutput.vOut, super.defaultSequenceNum);
            this.commitTxPrevOutputFetcher.push(commitTxPrevOutput.amount);
            totalSenderAmount += commitTxPrevOutput.amount;
        });

        this.inscriptionTxCtxDataList.forEach(inscriptionTxCtxData => {
            tx.addOutput(inscriptionTxCtxData.revealTxPrevOutput.pkScript, inscriptionTxCtxData.revealTxPrevOutput.value);
        });

        //commit fee
        const royaltyReceiverPkScript = bitcoin.address.toOutputScript(this.royaltyReceiver, network)
        for (let i = 0; i < this.repeat; i++) {
            tx.addOutput(royaltyReceiverPkScript, this.royalty);
        }

        const changePkScript = bitcoin.address.toOutputScript(changeAddress, network);
        tx.addOutput(changePkScript, 0);

        const txForEstimate = tx.clone();
        signTx(txForEstimate, commitTxPrevOutputList, this.network);

        const fee = Math.floor(txForEstimate.virtualSize() * commitFeeRate);
        const changeAmount = totalSenderAmount - totalRevealPrevOutputValue - fee - (this.royalty * this.repeat);
        console.log(changeAmount, minChangeValue)

        if (changeAmount >= minChangeValue) {
            tx.outs[tx.outs.length - 1].value = changeAmount;
        } else {
            tx.outs = tx.outs.slice(0, tx.outs.length - 1);
            txForEstimate.outs = txForEstimate.outs.slice(0, txForEstimate.outs.length - 1);
            const feeWithoutChange = Math.floor(txForEstimate.virtualSize() * commitFeeRate);
            if (totalSenderAmount - totalRevealPrevOutputValue - feeWithoutChange < 0) {
                this.mustCommitTxFee = fee;
                return true;
            }
        }
        this.commitTx = tx;
        return false;
    }
}


function createInscriptionTxCtxData(network, inscriptionData, privateKeyWif) {
    const privateKey = base.fromHex(bitcoin.privateKeyFromWIF(privateKeyWif, network));
    const internalPubKey = bitcoin.wif2Public(privateKeyWif, network).slice(1);

    const ops = bitcoin.script.OPS;

    const inscriptionBuilder = [];
    inscriptionBuilder.push(internalPubKey);
    inscriptionBuilder.push(ops.OP_CHECKSIG);
    inscriptionBuilder.push(ops.OP_FALSE);
    inscriptionBuilder.push(ops.OP_IF);
    inscriptionBuilder.push(Buffer.from("ord"));
    inscriptionBuilder.push(ops.OP_DATA_1);
    inscriptionBuilder.push(ops.OP_DATA_1);
    inscriptionBuilder.push(Buffer.from(inscriptionData.contentType));
    inscriptionBuilder.push(ops.OP_0);
    const maxChunkSize = 520;
    let body = Buffer.from(inscriptionData.body);
    let bodySize = body.length;
    for (let i = 0; i < bodySize; i += maxChunkSize) {
        let end = i + maxChunkSize;
        if (end > bodySize) {
            end = bodySize;
        }
        inscriptionBuilder.push(body.slice(i, end));
    }
    inscriptionBuilder.push(ops.OP_ENDIF);

    const inscriptionScript = bitcoin.script.compile(inscriptionBuilder);

    const scriptTree = {
        output: inscriptionScript,
    };
    const redeem = {
        output: inscriptionScript,
        redeemVersion: 0xc0,
    };

    const { output, witness, hash, address } = bitcoin.payments.p2tr({
        internalPubkey: internalPubKey,
        scriptTree,
        redeem,
        network,
    });

    return {
        privateKey,
        inscriptionScript,
        commitTxAddress: address,
        commitTxAddressPkScript: output,
        witness: witness,
        hash: hash,
        revealTxPrevOutput: {
            pkScript: Buffer.alloc(0),
            value: 0,
        },
        revealPkScript: bitcoin.address.toOutputScript(inscriptionData.revealAddr, network),
    };
}


function signTx(tx, commitTxPrevOutputList, network) {
    tx.ins.forEach((input, i) => {
        const addressType = bitcoin.getAddressType(commitTxPrevOutputList[i].address, network);
        const privateKey = base.fromHex(bitcoin.privateKeyFromWIF(commitTxPrevOutputList[i].privateKey, network));
        const privateKeyHex = base.toHex(privateKey);
        const publicKey = bitcoin.private2public(privateKeyHex);

        if (addressType === 'segwit_taproot') {
            const prevOutScripts = commitTxPrevOutputList.map(o => bitcoin.address.toOutputScript(o.address, network));
            const values = commitTxPrevOutputList.map(o => o.amount);
            const hash = tx.hashForWitnessV1(i, prevOutScripts, values, bitcoin.Transaction.SIGHASH_DEFAULT);
            const tweakedPrivKey = taprootTweakPrivKey(privateKey);
            const signature = Buffer.from(schnorr.sign(hash, tweakedPrivKey, base.randomBytes(32)));

            input.witness = [Buffer.from(signature)];

        } else if (addressType === 'legacy') {
            const prevScript = bitcoin.address.toOutputScript(commitTxPrevOutputList[i].address, network);
            const hash = tx.hashForSignature(i, prevScript, bitcoin.Transaction.SIGHASH_ALL);
            const signature = bitcoin.sign(hash, privateKeyHex);
            const payment = bitcoin.payments.p2pkh({
                signature: bitcoin.script.signature.encode(signature, bitcoin.Transaction.SIGHASH_ALL),
                pubkey: publicKey,
            });

            input.script = payment.input;

        } else {
            const pubKeyHash = bitcoin.crypto.hash160(publicKey);
            const prevOutScript = Buffer.of(0x19, 0x76, 0xa9, 0x14, ...pubKeyHash, 0x88, 0xac);
            const value = commitTxPrevOutputList[i].amount;
            const hash = tx.hashForWitness(i, prevOutScript, value, bitcoin.Transaction.SIGHASH_ALL);
            const signature = bitcoin.sign(hash, privateKeyHex);

            input.witness = [
                bitcoin.script.signature.encode(signature, bitcoin.Transaction.SIGHASH_ALL),
                publicKey,
            ];

            const redeemScript = Buffer.of(0x16, 0, 20, ...pubKeyHash);
            if (addressType === "segwit_nested") {
                input.script = redeemScript;
            }
        }
    });
}

function taprootTweakPrivKey(privKey, merkleRoot = new Uint8Array()) {
    const u = schnorr.utils;
    const seckey0 = u.bytesToNumberBE(privKey); // seckey0 = int_from_bytes(seckey0)
    const P = ProjPoint.fromPrivateKey(seckey0); // P = point_mul(G, seckey0)
    // seckey = seckey0 if has_even_y(P) else SECP256K1_ORDER - seckey0
    const seckey = P.hasEvenY() ? seckey0 : u.mod(-seckey0, CURVE_ORDER);
    const xP = u.pointToBytes(P);
    // t = int_from_bytes(tagged_hash("TapTweak", bytes_from_int(x(P)) + h)); >= SECP256K1_ORDER check
    const t = tapTweak(xP, merkleRoot);
    // bytes_from_int((seckey + t) % SECP256K1_ORDER)
    return u.numberToBytesBE(u.mod(seckey + t, CURVE_ORDER), 32);
}
function tapTweak(a, b) {
    const u = schnorr.utils;
    const t = u.taggedHash('TapTweak', a, b);
    const tn = u.bytesToNumberBE(t);
    if (tn >= CURVE_ORDER) throw new Error('tweak higher than curve order');
    return tn;
}


module.exports = Brc420InscriptionTool