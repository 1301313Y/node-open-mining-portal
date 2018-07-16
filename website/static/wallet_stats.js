$(function () {

    var skipCap = 5; // 5 mins as data is collected every 60 seconds
    var skipIndex = 5; //include first entry

    var workerHashrateData;
    var workerHashrateEmaData;
    var workerHashrateChart;
    var workerHistoryMax = 160;

    var statData;
    var totalHash;
    var totalImmature;
    var totalBal;
    var totalPaid;
    var totalShares;

    function timeOfDayFormat(timestamp) {
        var dStr = d3.time.format('%I:%M %p')(new Date(timestamp));
        if (dStr.indexOf('0') === 0) dStr = dStr.slice(1);
        return dStr;
    }

    function getWorkerNameFromAddress(w) {
        var worker = w;
        if (w.split(".").length > 1) {
            worker = w.split(".")[1];
            if (worker == null || worker.length < 1) {
                worker = "noname";
            }
        } else {
            worker = "noname";
        }
        return worker;
    }

    function buildChartData() {
        var workers = {};
        for (var w in statData.history) {
            var worker = getWorkerNameFromAddress(w);
            var a = workers[worker] = (workers[worker] || {
                hashrate: []
            });
            for (var wh in statData.history[w]) {
                if(skipIndex < skipCap){
                    skipIndex++;
                    continue;
                }
                skipIndex = 0;
                a.hashrate.push({
                    x: (statData.history[w][wh].time * 1000),
                    y: statData.history[w][wh].hashrate,
                    original: statData.history[w][wh].hashrate,
                    ema: 0
                });
            }
            if (a.hashrate.length > workerHistoryMax) {
                workerHistoryMax = a.hashrate.length;
            }
        }
        workerHashrateData = [];
        workerHashrateEmaData = [];
        for (var worker in workers) {
            let index = workerHashrateData.length;
            let color = chartColors[index % chartColors.length];
            applyExponentialMovingAVG(workers[worker].hashrate, 24);
            workerHashrateData.push({
                label: worker,
                data: workers[worker].hashrate,
                borderColor: color,
                backgroundColor: convertHex(color, 20)
            });
        }
    }

    function updateChartData() {
        var workers = {};
        for (var w in statData.history) {
            var worker = getWorkerNameFromAddress(w);
            // get a reference to lastest workerhistory
            for (var wh in statData.history[w]) {}
            //var wh = statData.history[w][statData.history[w].length - 1];
            var foundWorker = false;
            for (var i = 0; i < workerHashrateData.length; i++) {
                if (workerHashrateData[i].label === worker) {
                    foundWorker = true;
                    if(skipIndex < skipCap){
                        skipIndex++;
                        continue;
                    }
                    skipIndex = 0;
                    if (workerHashrateData[i].data.length >= workerHistoryMax) {
                        workerHashrateData[i].data.shift();
                        workerHashrateChart.data.datasets[i].data.shift();
                    }
                    let entry = {
                        x: (statData.history[w][wh].time * 1000),
                        y: statData.history[w][wh].hashrate
                    };
                    workerHashrateData[i].data.push(entry);
                    workerHashrateChart.data.datasets[i].data.push(entry);
                    break;
                }
            }
            if (!foundWorker) {
                var hashrate = [];
                let index = workerHashrateData.length;
                let color = chartColors[index % chartColors.length];
                hashrate.push({ x: statData.history[w][wh].time * 1000, y: statData.history[w][wh].hashrate });
                let entry = {
                    label: worker,
                    data: hashrate,
                    borderColor: color,
                    backgroundColor: convertHex(color, 20),
                };
                workerHashrateData.push(entry);
                workerHashrateChart.data.datasets.push(entry);
                workerHashrateChart.update();
                return true;
            }
        }
        workerHashrateChart.update();
        return false;
    }

    function calculateAverageHashrate(worker) {
        var count = 0;
        var total = 1;
        var avg = 0;
        for (var i = 0; i < workerHashrateData.length; i++) {
            count = 0;
            for (var ii in workerHashrateData[i].data) {
                if (worker == null || workerHashrateData[i].label === worker) {
                    count++;
                    avg += parseFloat(workerHashrateData[i].data[ii].y);
                }
            }
            if (count > total)
                total = count;
        }
        avg = avg / total;
        return avg;
    }

    function triggerChartUpdates() {
        //workerHashrateChart.update();
    }

    function displayHashrateChart() {
        var ctx = $('#myChart');
        workerHashrateChart = new Chart(ctx, {
            // The type of chart we want to create
            type: 'line',
            data: {
                datasets: workerHashrateData.map((i) => {
                    return { 
                        label: i.label,
                        data: i.data.map((e) => { return { x: e.x, y: e.ema }; }),
                        borderColor: i.borderColor,
                        backgroundColor: i.backgroundColor,
                    }; 
                })
            },
            // Configuration options go here
            options: {
                tooltips: {
                    callbacks: {
                        title: function(tooltipItem, data) {
                            return Date(tooltipItem).toLocaleString();
                        },
                        label: function(tooltipItem, data) {
                            return formatHashrate(tooltipItem.yLabel);
                        }
                    }
                },
                scales: {
                    yAxes: [{
                        beginAtZero: true,
                        gridLines: {
                            color: "rgba(100, 100, 100, 0.1)"
                        },
                        ticks: {
                            beginAtZero: true,
                            steps: 10,
                            stepValue: 5,
                            callback: function(value, index, values) {
                                return formatHashrate(value);
                            }
                        },
                    }],
                    xAxes: [{
                        type: 'time',
                        distribution: 'series',
                        gridLines: {
                            display: false
                        },
                        ticks: {
                            source: 'data'
                        }
                    }]
                }
            }
        });
    }

    function updateStats() {
        totalHash = statData.totalHash;
        totalPaid = statData.paid;
        totalBal = statData.balance;
        totalImmature = statData.immature;
        totalShares = statData.totalShares;
        // do some calculations
        var _blocktime = 250;
        var _networkHashRate = parseFloat(statData.networkSols) * 1.2;
        var _myHashRate = (totalHash / 1000000) * 2;
        var luckDays = ((_networkHashRate / _myHashRate * _blocktime) / (24 * 60 * 60)).toFixed(3);
        // update miner stats
        $("#hashrate-wallet-total").text(formatHashrate(totalHash));
        $("#statsHashrateAvg").text(formatHashrate(calculateAverageHashrate(null)));
        $("#statsLuckDays").text(luckDays);
        $("#statsTotalImmature").text(totalImmature);
        $("#statsTotalBal").text(totalBal);
        $("#statsTotalPaid").text(totalPaid);
        $("#statsTotalShares").text(totalShares.toFixed(2));
    }

    function updateWorkerStats() {
        // update worker stats
        var i = 0;
        let hashSum = 0;
        let totalBalance = 0;
        let totalPaid = 0;
        let totalShares = 0;
        for (var w in statData.workers) {
            i++;
            var htmlSafeWorkerName = w.split('.').join('_').replace(/[^\w\s]/gi, '');
            var saneWorkerName = getWorkerNameFromAddress(w);
            hashSum += statData.workers[w].hashrate;
            totalBalance += statData.workers[w].balance;
            totalPaid += statData.workers[w].paid;
            totalShares += Math.round(statData.workers[w].currRoundShares * 100) / 100;
        }
        $("#workers-active-total").text(Object.keys(statData.workers).length);
        $("#hashrate-wallet-worker-average").text(formatHashrate(hashSum / i));
        $("#payout-paid-total").text(totalPaid.toFixed(8));
        $("#payout-balance-total").text(totalBalance.toFixed(8));
        $("#shares-wallet-total").text(totalShares.toFixed(0));
    }

    function addWorkerToDisplay(name, htmlSafeName, workerObj) {
        var htmlToAdd = "<tr>";
        if (htmlSafeName.indexOf("_") >= 0) {
            htmlToAdd += '<td>' + htmlSafeName.substr(htmlSafeName.indexOf("_") + 1, htmlSafeName.length) + '</td>';
        } else {
            htmlToAdd += '<td>No Name</td>';
        }
        htmlToAdd += '<td><span id="statsHashrate' + htmlSafeName + '">' + formatHashrate(workerObj.hashrate) + '</span> (Now)</td>';
        htmlToAdd += '<td><span id="statsHashrateAvg' + htmlSafeName + '">' + formatHashrate(calculateAverageHashrate(name)) + '</span></td>';
        htmlToAdd += '<td><span id="statsBalance' + htmlSafeName + '">' + workerObj.balance.toFixed(8) + '</span></td>';
        htmlToAdd += '<td><span id="statsPaid' + htmlSafeName + '">' + workerObj.paid.toFixed(8) + '</span></td>';
        htmlToAdd += '<td><span id="statsShares' + htmlSafeName + '">' + (Math.round(workerObj.currRoundShares * 100) / 100).toFixed(0) + '</span></td>';
        htmlToAdd += '</tr>';
        $("#table-worker-body").append(htmlToAdd);
    }

    function rebuildWorkerDisplay() {
        $("#table-worker-body").html("");
        var i = 0;
        for (var w in statData.workers) {
            i++;
            var htmlSafeWorkerName = w.split('.').join('_').replace(/[^\w\s]/gi, '');
            var saneWorkerName = getWorkerNameFromAddress(w);
            addWorkerToDisplay(saneWorkerName, htmlSafeWorkerName, statData.workers[w]);
        }
    }

    // resize chart on window resize
    nv.utils.windowResize(triggerChartUpdates);

    // grab initial stats
    $.getJSON('/api/worker_stats?' + _miner, function (data) {
        statData = data;
        for (var w in statData.workers) {
            _workerCount++;
        }
        buildChartData();
        displayHashrateChart();
        rebuildWorkerDisplay();
        updateStats();
        updateWorkerStats();
    });

    // live stat updates
    statsSource.addEventListener('message', function (e) {
        // TODO, create miner_live_stats...
        // miner_live_stats will return the same josn except without the worker history
        // FOR NOW, use this to grab updated stats
        $.getJSON('/api/worker_stats?' + _miner, function (data) {
            statData = data;
            // check for missing workers
            var wc = 0;
            var rebuilt = false;
            // update worker stats
            for (var w in statData.workers) {
                wc++;
            }
            rebuilt = (rebuilt || updateChartData());
            updateStats();
            if (!rebuilt) {
                updateWorkerStats();
                rebuildWorkerDisplay();
            }
        });
    });
})