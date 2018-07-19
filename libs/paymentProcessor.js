var fs = require('fs');

var redis = require('redis');
var async = require('async');

var Stratum = require('stratum-pool');
var util = require('stratum-pool/lib/util.js');

const loggerFactory = require('./logger.js');

module.exports = function(_logger){

    let logger = loggerFactory.getLogger('Payments', 'system');

    var poolConfigs = JSON.parse(process.env.pools);
    logger.info("Payment processor worker started");

    var enabledPools = [];

    Object.keys(poolConfigs).forEach(function(coin) {
        var poolOptions = poolConfigs[coin];
        if (poolOptions.paymentProcessing &&
            poolOptions.paymentProcessing.enabled)
            enabledPools.push(coin);
            logger.info("Enabled %s for payment processing", coin);
    });

    async.filter(enabledPools, function(coin, callback){
        setupForPool(_logger, poolConfigs[coin], function(setupResults){
            logger.debug("Processing processor initialized. Setup results %s", setupResults);
            callback(setupResults);
        });
    }, function(err, coins){
        if(err){
            logger.error('Error processing enabled pools in the config') // TODO: ASYNC LIB was updated, need to report a better error
        } else {
            coins.forEach(function(coin){

                var poolOptions = poolConfigs[coin];
                var processingConfig = poolOptions.paymentProcessing;
                var logSystem = 'Payments';
                var logComponent = coin;

                logger.info('Payment processing setup to run every %s second(s) with daemon (%s@%s:%s) and redis (%s:%s)',
                processingConfig.paymentInterval,
                processingConfig.daemon.user,
                processingConfig.daemon.host,
                processingConfig.daemon.port,
                poolOptions.redis.host,
                poolOptions.redis.port);
            });
        }
    });
};

function setupForPool(_logger, poolOptions, setupFinished){

    let logger = loggerFactory.getLogger('Payments', 'system');

    var coin = poolOptions.coin.name;
    var processingConfig = poolOptions.paymentProcessing;

    var logSystem = 'Payments';
    var logComponent = coin;

    var daemon = new Stratum.daemon.interface([processingConfig.daemon], function(severity, message){
        _logger[severity](logSystem, logComponent, message);
    });
    var redisClient = redis.createClient(poolOptions.redis.port, poolOptions.redis.host);

    var magnitude;
    var minPaymentSatoshis;
    var coinPrecision;

    var paymentInterval;

    logger.debug('Validating address and balance');

    async.parallel([
        function(callback){
            daemon.cmd('validateaddress', [poolOptions.address], function(result) {
                if (result.error){
                    logger.silly('Validated %s address with result %s', poolOptions.address, JSON.stringify(result));
                    callback(true);
                }
                else if (!result.response || !result.response.ismine) {
                            daemon.cmd('getaddressinfo', [poolOptions.address], function(result) {
                        if (result.error){
                            logger.error('Error with payment processing daemon %s', JSON.stringify(result.error));
                            callback(true);
                        }
                        else if (!result.response || !result.response.ismine) {
                            logger.error('Daemon does not own pool address - payment processing can not be done with this daemon, %s', JSON.stringify(result.response));
                            callback(true);
                        }
                        else{
                            callback()
                        }
                    }, true);
                }
                else{
                    callback()
                }
            }, true);
        },
        function(callback){
            daemon.cmd('getbalance', [], function(result){
                if (result.error){
                    callback(true);
                    return;
                }
                try {
                    var d = result.data.split('result":')[1].split(',')[0].split('.')[1];
                    magnitude = parseInt('10' + new Array(d.length).join('0'));
                    minPaymentSatoshis = parseInt(processingConfig.minimumPayment * magnitude);
                    coinPrecision = magnitude.toString().length - 1;
                    callback();
                }
                catch(e){
                    logger.error('Error detecting number of satoshis in a coin, cannot do payment processing. Tried parsing: %s', JSON.stringify(result.data));
                    callback(true);
                }

            }, true, true);
        }
    ], function(err){
        if (err){
            logger.error("There was error during payment processor setup %s", JSON.stringify(err));
            setupFinished(false);
            return;
        }
        paymentInterval = setInterval(function(){
            try {
                processPayments();
                logger.info("Set up to process payments every %s seconds", processingConfig.paymentInterval);
            } catch(e){
                logger.error("There was error during payment processor setup %s", JSON.stringify(e));
                throw e;
            }
        }, processingConfig.paymentInterval * 1000);
        setTimeout(processPayments, 100);
        setupFinished(true);
    });

    function roundTo(n, digits) {
        if (digits === undefined) {
            digits = 0;
        }
        var multiplicator = Math.pow(10, digits);
        n = parseFloat((n * multiplicator).toFixed(11));
        var test =(Math.round(n) / multiplicator);
        return +(test.toFixed(digits));
    }

    var satoshisToCoins = function(satoshis){
        return parseFloat((satoshis / magnitude).toFixed(coinPrecision));
    };

    var coinsToSatoshies = function(coins){
        return coins * magnitude;
    };

    function coinsRound(number) {
        return roundTo(number, coinPrecision);
    }

    function checkForDuplicateBlockHeight(rounds, height) {
        var count = 0;
        for (var i = 0; i < rounds.length; i++) {
            if (rounds[i].height == height)
                count++;
        }
        return count > 1;
    }

    /* Deal with numbers in smallest possible units (satoshis) as much as possible. This greatly helps with accuracy
       when rounding and whatnot. When we are storing numbers for only humans to see, store in whole coin units. */

    var processPayments = function(){

        var startPaymentProcess = Date.now();

        var timeSpentRPC = 0;
        var timeSpentRedis = 0;

        var startTimeRedis;
        var startTimeRPC;

        var startRedisTimer = function(){ startTimeRedis = Date.now() };
        var endRedisTimer = function(){ timeSpentRedis += Date.now() - startTimeRedis };

        var startRPCTimer = function(){ startTimeRPC = Date.now(); };
        var endRPCTimer = function(){ timeSpentRPC += Date.now() - startTimeRedis };

        async.waterfall([
            /*
                Step 1 - build workers and rounds objects from redis
                         * removes duplicate block submissions from redis
            */
            function(callback){
                logger.debug("Calling redis for array of rounds");
                startRedisTimer();
                redisClient.multi([
                    ['hgetall', coin + ':balances'],
                    ['smembers', coin + ':blocksPending']
                ]).exec(function(error, results){
                    logger.debug("Redis responsed: %s", JSON.stringify(results));
                    endRedisTimer();
                    if (error){
                        logger.error('Could not get blocks from redis %s', JSON.stringify(error));
                        callback(true);
                        return;
                    }
                    // build workers object from :balances
                    var workers = {};
                    for (var w in results[0]){
                        workers[w] = {balance: coinsToSatoshies(parseFloat(results[0][w]))};
                    }
                    // build rounds object from :blocksPending
                    var rounds = results[1].map(function(r){
                        var details = r.split(':');
                        return {
                            blockHash: details[0],
                            txHash: details[1],
                            height: details[2],
                            minedby: details[3],
                            time: details[4],
                            duplicate: false,
                            serialized: r
                        };
                    });
                    /* sort rounds by block hieght to pay in order */
                    rounds.sort(function(a, b) {
                        return a.height - b.height;
                    });
                    // find duplicate blocks by height
                    // this can happen when two or more solutions are submitted at the same block height
                    var duplicateFound = false;
                    for (var i = 0; i < rounds.length; i++) {
                        if (checkForDuplicateBlockHeight(rounds, rounds[i].height) === true) {
                            rounds[i].duplicate = true;
                            duplicateFound = true;
                        }
                    }
                    // handle duplicates if needed
                    if (duplicateFound) {
                        var dups = rounds.filter(function(round){ return round.duplicate; });
                        logger.warning('Duplicate pending blocks found: %s', JSON.stringify(dups));
                        // attempt to find the invalid duplicates
                        var rpcDupCheck = dups.map(function(r){
                            return ['getblock', [r.blockHash]];
                        });
                        startRPCTimer();
                        daemon.batchCmd(rpcDupCheck, function(error, blocks){
                            endRPCTimer();
                            if (error || !blocks) {
                                logger.error('Error with duplicate block check rpc call getblock $s', JSON.stringify(error));
                                return;
                            }
                            // look for the invalid duplicate block
                            var validBlocks = {}; // hashtable for unique look up
                            var invalidBlocks = []; // array for redis work
                            blocks.forEach(function(block, i) {
                                if (block && block.result) {
                                    // invalid duplicate submit blocks have negative confirmations
                                    if (block.result.confirmations < 0) {
                                        logger.warning('Remove invalid duplicate block %s > %s', block.result.height, block.result.hash);
                                        // move from blocksPending to blocksDuplicate...
                                        invalidBlocks.push(['smove', coin + ':blocksPending', coin + ':blocksDuplicate', dups[i].serialized]);
                                    } else {
                                        // block must be valid, make sure it is unique
                                        if (validBlocks.hasOwnProperty(dups[i].blockHash)) {
                                            // not unique duplicate block
                                            logger.warning('Remove non-unique duplicate block %s > %s' + block.result.height, block.result.hash);
                                            // move from blocksPending to blocksDuplicate...
                                            invalidBlocks.push(['smove', coin + ':blocksPending', coin + ':blocksDuplicate', dups[i].serialized]);
                                        } else {
                                            // keep unique valid block
                                            validBlocks[dups[i].blockHash] = dups[i].serialized;
                                            logger.debug('Keep valid duplicate block %s > %s', block.result.height, block.result.hash);
                                        }
                                    }
                                }
                            });
                            // filter out all duplicates to prevent double payments
                            rounds = rounds.filter(function(round){ return !round.duplicate; });
                            // if we detected the invalid duplicates, move them
                            if (invalidBlocks.length > 0) {
                                // move invalid duplicate blocks in redis
                                startRedisTimer();
                                redisClient.multi(invalidBlocks).exec(function(error, kicked){
                                    endRedisTimer();
                                    if (error) {
                                        logger.error('Error could not move invalid duplicate blocks in redis ' + JSON.stringify(error));
                                    }
                                    // continue payments normally
                                    callback(null, workers, rounds);
                                });
                            } else {
                                // notify pool owner that we are unable to find the invalid duplicate blocks, manual intervention required...
                                logger.error('Unable to detect invalid duplicate blocks, duplicate block payments on hold.');
                                // continue payments normally
                                callback(null, workers, rounds);
                            }
                        });
                    } else {
                        // no duplicates, continue payments normally
                        callback(null, workers, rounds);
                    }
                });
            },

            /* Does a batch rpc call to daemon with all the transaction hashes to see if they are confirmed yet.
               It also adds the block reward amount to the round object - which the daemon gives also gives us. */
            function(workers, rounds, callback){

                var batchRPCcommand = rounds.map(function(r){
                    return ['gettransaction', [r.txHash]];
                });

                batchRPCcommand.push(['getaccount', [poolOptions.address]]);

                startRPCTimer();
                daemon.batchCmd(batchRPCcommand, function(error, txDetails){
                    endRPCTimer();

                    if (error || !txDetails){
                        logger.error('Check finished - daemon rpc error with batch gettransactions %s', JSON.stringify(error));
                        callback(true);
                        return;
                    }

                    var addressAccount;

                    txDetails.forEach(function(tx, i){

                        if (i === txDetails.length - 1){
                            addressAccount = tx.result;
                            return;
                        }

                        var round = rounds[i];

                        if (tx.error && tx.error.code === -5){
                            logger.warning('Daemon reports invalid transaction: %s', round.txHash);
                            round.category = 'kicked';
                            return;
                        }
                        else if (!tx.result.details || (tx.result.details && tx.result.details.length === 0)){
                            logger.warning('Daemon reports no details for transaction: %s', round.txHash);
                            round.category = 'kicked';
                            return;
                        }
                        else if (tx.error || !tx.result){
                            logger.error('Odd error with gettransaction %s %s', round.txHash, JSON.stringify(tx));
                            return;
                        }

                        var generationTx = tx.result.details.filter(function(tx){
                            return tx.address === poolOptions.address;
                        })[0];


                        if (!generationTx && tx.result.details.length === 1){
                            generationTx = tx.result.details[0];
                        }

                        if (!generationTx){
                            logger.error('Missing output details to pool address for transaction %s', round.txHash);
                            return;
                        }

                        round.category = generationTx.category;
                        if (round.category === 'generate') {
                            round.reward = generationTx.amount || generationTx.value;
                        }

                    });

                    var canDeleteShares = function(r){
                        for (var i = 0; i < rounds.length; i++){
                            var compareR = rounds[i];
                            if ((compareR.height === r.height)
                                && (compareR.category !== 'kicked')
                                && (compareR.category !== 'orphan')
                                && (compareR.serialized !== r.serialized)){
                                return false;
                            }
                        }
                        return true;
                    };


                    //Filter out all rounds that are immature (not confirmed or orphaned yet)
                    rounds = rounds.filter(function(r){
                        switch (r.category) {
                            case 'orphan':
                            case 'kicked':
                                r.canDeleteShares = canDeleteShares(r);
                            case 'generate':
                                return true;
                            default:
                                return false;
                        }
                    });


                    callback(null, workers, rounds, addressAccount);

                });
            },


            /* Does a batch redis call to get shares contributed to each round. Then calculates the reward
               amount owned to each miner for each round. */
            function(workers, rounds, addressAccount, callback){


                var shareLookups = rounds.map(function(r){
                    return ['hgetall', coin + ':shares:round' + r.height]
                });

                startRedisTimer();
                redisClient.multi(shareLookups).exec(function(error, allWorkerShares){
                    endRedisTimer();

                    if (error){
                        callback('Check finished - redis error with multi get rounds share');
                        return;
                    }


                    rounds.forEach(function(round, i){
                        var workerShares = allWorkerShares[i];

                        if (!workerShares){
                            logger.error('No worker shares for round: %s; blockhash: %s', round.height, round.blockHash);
                            return;
                        }

                        switch (round.category){
                            case 'kicked':
                            case 'orphan':
                                round.workerShares = workerShares;
                                break;

                            case 'generate':
                                /* We found a confirmed block! Now get the reward for it and calculate how much
                                   we owe each miner based on the shares they submitted during that block round. */
                                var reward = parseInt(round.reward * magnitude);

                                var totalShares = Object.keys(workerShares).reduce(function(p, c){
                                    return p + parseFloat(workerShares[c])
                                }, 0);

                                for (var workerAddress in workerShares){
                                    var percent = parseFloat(workerShares[workerAddress]) / totalShares;
                                    var workerRewardTotal = Math.floor(reward * percent);
                                    var worker = workers[workerAddress] = (workers[workerAddress] || {});
                                    worker.reward = (worker.reward || 0) + workerRewardTotal;
                                }
                                break;
                        }
                    });

                    callback(null, workers, rounds, addressAccount);
                });
            },


            /* Calculate if any payments are ready to be sent and trigger them sending
             Get balance different for each address and pass it along as object of latest balances such as
             {worker1: balance1, worker2, balance2}
             when deciding the sent balance, it the difference should be -1*amount they had in db,
             if not sending the balance, the differnce should be +(the amount they earned this round)
             */
            function(workers, rounds, addressAccount, callback) {

                var tries = 0;
                var trySend = function (withholdPercent) {

                    var addressAmounts = {};
                    var balanceAmounts = {};
                    var shareAmounts = {};
                    var timePeriods = {};
                    var minerTotals = {};
                    var totalSent = 0;
                    var totalShares = 0;

                    // track attempts made, calls to trySend...
                    tries++;

                    // total up miner's balances
                    for (var w in workers) {
                        var worker = workers[w];
                        totalShares += (worker.totalShares || 0)
                        worker.balance = worker.balance || 0;
                        worker.reward = worker.reward || 0;
                        // get miner payout totals
                        var toSendSatoshis = Math.round((worker.balance + worker.reward) * (1 - withholdPercent));
                        var address = worker.address = (worker.address || getProperAddress(w.split('.')[0])).trim();
                        if (minerTotals[address] != null && minerTotals[address] > 0) {
                            minerTotals[address] += toSendSatoshis;
                        } else {
                            minerTotals[address] = toSendSatoshis;
                        }
                    }
                    // now process each workers balance, and pay the miner
                    for (var w in workers) {
                        logger.silly('w = %s', w);
                        var worker = workers[w];
                        logger.silly('worker = %s', JSON.stringify(worker));
                        worker.balance = worker.balance || 0;
                        logger.silly('worker.balance = %s', worker.balance);
                        worker.reward = worker.reward || 0;
                        logger.silly('worker.reward = %s', worker.reward);
                        var toSendSatoshis = Math.round((worker.balance + worker.reward) * (1 - withholdPercent));
                        logger.silly('toSendSatoshis = %s', toSendSatoshis);
                        var address = worker.address = (worker.address || getProperAddress(w.split('.')[0])).trim();
                        // if miners total is enough, go ahead and add this worker balance
                        if (minerTotals[address] >= minPaymentSatoshis) {
                            totalSent += toSendSatoshis;
                            // send funds
                            worker.sent = satoshisToCoins(toSendSatoshis);
                            worker.balanceChange = Math.min(worker.balance, toSendSatoshis) * -1;
                            if (addressAmounts[address] != null && addressAmounts[address] > 0) {
                                addressAmounts[address] = coinsRound(addressAmounts[address] + worker.sent);
                            } else {
                                addressAmounts[address] = worker.sent;
                            }
                        } else {
                            // add to balance, not enough minerals
                            worker.sent = 0;
                            worker.balanceChange = Math.max(toSendSatoshis - worker.balance, 0);
                            // track balance changes
                            if (worker.balanceChange > 0) {
                                if (balanceAmounts[address] != null && balanceAmounts[address] > 0) {
                                    balanceAmounts[address] = coinsRound(balanceAmounts[address] + satoshisToCoins(worker.balanceChange));
                                } else {
                                    balanceAmounts[address] = satoshisToCoins(worker.balanceChange);
                                }
                            }
                        }
                        // track share work
                        if (worker.totalShares > 0) {
                            if (shareAmounts[address] != null && shareAmounts[address] > 0) {
                                shareAmounts[address] += worker.totalShares;
                            } else {
                                shareAmounts[address] = worker.totalShares;
                            }
                        }
                    }

                    // if no payouts...continue to next set of callbacks
                    if (Object.keys(addressAmounts).length === 0){
                        callback(null, workers, rounds, []);
                        return;
                    }

                    // do final rounding of payments per address
                    // this forces amounts to be valid (0.12345678)
                    for (var a in addressAmounts) {
                        addressAmounts[a] = coinsRound(addressAmounts[a]);
                    }

                    // POINT OF NO RETURN! GOOD LUCK!
                    // WE ARE SENDING PAYMENT CMD TO DAEMON

                    // perform the sendmany operation .. addressAccount
                    var rpccallTracking = 'sendmany "" '+JSON.stringify(addressAmounts);
                    //console.log(rpccallTracking);

                    daemon.cmd('sendmany', ["", addressAmounts], function (result) {
                        // check for failed payments, there are many reasons
                        if (result.error && result.error.code === -6) {
                            // check if it is because we don't have enough funds
                            if (result.error.message && result.error.message.includes("insufficient funds")) {
                                // only try up to XX times (Max, 0.5%)
                                if (tries < 5) {
                                    // we thought we had enough funds to send payments, but apparently not...
                                    // try decreasing payments by a small percent to cover unexpected tx fees?
                                    var higherPercent = withholdPercent + 0.001; // 0.1%
                                    logger.warning('Insufficient funds (??) for payments ('+satoshisToCoins(totalSent)+'), decreasing rewards by ' + (higherPercent * 100).toFixed(1) + '% and retrying');
                                    trySend(higherPercent);
                                } else {
                                    logger.warning(rpccallTracking);
                                    logger.error("Error sending payments, decreased rewards by too much!!!");
                                    callback(true);
                                }
                            } else {
                                // there was some fatal payment error?
                                logger.warning(rpccallTracking);
                                logger.error('Error sending payments ' + JSON.stringify(result.error));
                                // payment failed, prevent updates to redis
                                callback(true);
                            }
                            return;
                        }
                        else if (result.error && result.error.code === -5) {
                            // invalid address specified in addressAmounts array
                            logger.warning(rpccallTracking);
                            logger.error('Error sending payments ' + JSON.stringify(result.error));
                            // payment failed, prevent updates to redis
                            callback(true);
                            return;
                        }
                        else if (result.error && result.error.message != null) {
                            // invalid amount, others?
                            logger.warning(rpccallTracking);
                            logger.error('Error sending payments ' + JSON.stringify(result.error));
                            // payment failed, prevent updates to redis
                            callback(true);
                            return;
                        }
                        else if (result.error) {
                            // unknown error
                            logger.error('Error sending payments ' + JSON.stringify(result.error));
                            // payment failed, prevent updates to redis
                            callback(true);
                            return;
                        }
                        else {
                            // make sure sendmany gives us back a txid
                            var txid = result ? result.response : false;
                            if (txid) {
                                // it worked, congrats on your pools payout ;)
                                logger.special('Sent ' + satoshisToCoins(totalSent)
                                    + ' to ' + Object.keys(addressAmounts).length + ' miners; txid: '+txid);

                                if (withholdPercent > 0) {
                                    logger.warning('Had to withhold ' + (withholdPercent * 100)
                                        + '% of reward from miners to cover transaction fees. '
                                        + 'Fund pool wallet with coins to prevent this from happening');
                                }

                                // save payments data to redis
                                var paymentBlocks = rounds.filter(function(r){ return r.category == 'generate'; }).map(function(r){
                                    return parseInt(r.height);
                                });

                                var paymentsUpdate = [];
                                var paymentsData = {time:Date.now(), txid:txid, shares:totalShares, paid:satoshisToCoins(totalSent),  miners:Object.keys(addressAmounts).length, blocks: paymentBlocks, amounts: addressAmounts, balances: balanceAmounts, work:shareAmounts};
                                paymentsUpdate.push(['zadd', logComponent + ':payments', Date.now(), JSON.stringify(paymentsData)]);

                                callback(null, workers, rounds, paymentsUpdate);

                            } else {

                                clearInterval(paymentInterval);

                                logger.error('Error RPC sendmany did not return txid '
                                    + JSON.stringify(result) + 'Disabling payment processing to prevent possible double-payouts.');

                                callback(true);
                                return;
                            }
                        }
                    }, true, true);
                };
                trySend(0);

            },
            function(workers, rounds, paymentsUpdate, callback){

                var totalPaid = 0;
                var paymentsUpdate = [];
                var balanceUpdateCommands = [];
                var workerPayoutsCommand = [];

                for (var w in workers) {
                    var worker = workers[w];
                    if (worker.balanceChange !== 0){
                        balanceUpdateCommands.push([
                            'hincrbyfloat',
                            coin + ':balances',
                            w,
                            satoshisToCoins(worker.balanceChange)
                        ]);
                    }
                    if (worker.sent !== 0){
                        workerPayoutsCommand.push(['hincrbyfloat', coin + ':payouts', w, worker.sent]);
                        totalPaid += worker.sent;
                    }
                }



                var movePendingCommands = [];
                var roundsToDelete = [];
                var orphanMergeCommands = [];

                var confirmsUpdate = [];
                var confirmsToDelete = [];

                var moveSharesToCurrent = function(r){
                    var workerShares = r.workerShares;
                    Object.keys(workerShares).forEach(function(worker){
                        orphanMergeCommands.push(['hincrby', coin + ':shares:roundCurrent',
                            worker, workerShares[worker]]);
                    });
                };

                rounds.forEach(function(r){

                    switch(r.category){
                        case 'kicked':
                            confirmsToDelete.push(['hdel', coin + ':blocksPendingConfirms', r.blockHash]);
                            movePendingCommands.push(['smove', coin + ':blocksPending', coin + ':blocksKicked', r.serialized]);
                        case 'orphan':
                            movePendingCommands.push(['smove', coin + ':blocksPending', coin + ':blocksOrphaned', r.serialized]);
                            if (r.canDeleteShares){
                                moveSharesToCurrent(r);
                                roundsToDelete.push(coin + ':shares:round' + r.height);
                            }
                            return;
                        case 'immature':
                            confirmsUpdate.push(['hset', coin + ':blocksPendingConfirms', r.blockHash, (r.confirmations || 0)]);
                            return;
                        case 'generate':
                            confirmsToDelete.push(['hdel', coin + ':blocksPendingConfirms', r.blockHash]);
                            movePendingCommands.push(['smove', coin + ':blocksPending', coin + ':blocksConfirmed', r.serialized]);
                            roundsToDelete.push(coin + ':shares:round' + r.height);
                            return;
                    }

                });

                var finalRedisCommands = [];

                if (movePendingCommands.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(movePendingCommands);

                if (orphanMergeCommands.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(orphanMergeCommands);

                if (balanceUpdateCommands.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(balanceUpdateCommands);

                if (workerPayoutsCommand.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(workerPayoutsCommand);

                if (roundsToDelete.length > 0)
                    finalRedisCommands.push(['del'].concat(roundsToDelete));

                if (confirmsUpdate.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(confirmsUpdate);

                if (confirmsToDelete.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(confirmsToDelete);

                if (paymentsUpdate.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(paymentsUpdate);

                if (totalPaid !== 0)
                    finalRedisCommands.push(['hincrbyfloat', coin + ':stats', 'totalPaid', totalPaid]);

                if (finalRedisCommands.length === 0){
                    callback();
                    return;
                }

                startRedisTimer();
                redisClient.multi(finalRedisCommands).exec(function(error, results){
                    endRedisTimer();
                    if (error){
                        clearInterval(paymentInterval);
                        logger.error('Payments sent but could not update redis. ' + JSON.stringify(error)
                                + ' Disabling payment processing to prevent possible double-payouts. The redis commands in '
                                + coin + '_finalRedisCommands.txt must be ran manually');
                        fs.writeFile(coin + '_finalRedisCommands.txt', JSON.stringify(finalRedisCommands), function(err){
                            logger.error('Could not write finalRedisCommands.txt, you are fucked.');
                        });
                    }
                    callback();
                });
            }

        ], function(){

            var paymentProcessTime = Date.now() - startPaymentProcess;
            logger.debug('Finished interval - time spent: '
                + paymentProcessTime + 'ms total, ' + timeSpentRedis + 'ms redis, '
                + timeSpentRPC + 'ms daemon RPC');

        });
    };

    function cacheNetworkStats () {
        var params = null;
        daemon.cmd('getmininginfo', params,
            function (result) {
                if (!result || result.error || result[0].error || !result[0].response) {
                    logger.error('Error with RPC call getmininginfo '+JSON.stringify(result[0].error));
                    return;
                }

                var coin = logComponent;
                var finalRedisCommands = [];

                if (result[0].response.blocks !== null) {
                    finalRedisCommands.push(['hset', coin + ':stats', 'networkBlocks', result[0].response.blocks]);
                }
                if (result[0].response.difficulty !== null) {
                    finalRedisCommands.push(['hset', coin + ':stats', 'networkDiff', result[0].response.difficulty]);
                }
                if (result[0].response.networkhashps !== null) {
                    finalRedisCommands.push(['hset', coin + ':stats', 'networkHash', result[0].response.networkhashps]);
                }

                daemon.cmd('getnetworkinfo', params,
                    function (result) {
                        if (!result || result.error || result[0].error || !result[0].response) {
                            logger.error('Error with RPC call getnetworkinfo '+JSON.stringify(result[0].error));
                            return;
                        }

                        if (result[0].response.connections !== null) {
                            finalRedisCommands.push(['hset', coin + ':stats', 'networkConnections', result[0].response.connections]);
                        }
                        if (result[0].response.version !== null) {
                            finalRedisCommands.push(['hset', coin + ':stats', 'networkVersion', result[0].response.version]);
                        }
                        if (result[0].response.subversion !== null) {
                            finalRedisCommands.push(['hset', coin + ':stats', 'networkSubVersion', result[0].response.subversion]);
                        }
                        if (result[0].response.protocolversion !== null) {
                            finalRedisCommands.push(['hset', coin + ':stats', 'networkProtocolVersion', result[0].response.protocolversion]);
                        }

                        if (finalRedisCommands.length <= 0)
                            return;

                        redisClient.multi(finalRedisCommands).exec(function(error, results){
                            if (error){
                                logger.error('Error with redis during call to cacheNetworkStats() ' + JSON.stringify(error));
                                return;
                            }
                        });
                    }
                );
            }
        );
    }


    var getProperAddress = function(address){
        if (address.length === 40){
            return util.addressFromEx(poolOptions.address, address);
        }
        else return address;
    };

      // network stats caching every 58 seconds
      var stats_interval = 58 * 1000;
      var statsInterval = setInterval(function() {
          // update network stats using coin daemon
          cacheNetworkStats();
      }, stats_interval);


}
