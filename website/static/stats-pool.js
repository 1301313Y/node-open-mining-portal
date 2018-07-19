/* global _pool */
$(window).on('load', function() {
    var chartColors = [
        '#e91e63',
        '#9c27b0',
        '#673ab7',
        '#f44336',
        '#3f51b5',
        '#2196f3',
        '#03a9f4',
        '#00bcd4',
        '#009688',
        '#4caf50',
        '#8bc34a',
        '#cddc39',
        '#ffeb3b',
        '#ffc107',
        '#ff9800',
        '#ff5722',
        '#795548',
        '#9e9e9e',
        '#607d8b'
    ];

    var skipCap = 5; // 5 mins as data is collected every 60 seconds
    var skipIndex = skipCap; //include first entry

    var poolData;

    var charts = {
        workers: undefined,
        hashrate: undefined,
        distWorkers: undefined,
        distHashrate: undefined
    };

    var graphData = {
        workers: [],
        hashrate: [],
        blocks: []
    };

    var getHashrateString = function (hash) {
        var hashrate = hash;
        var i = 0;
        var units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
        while (hashrate > 1000) {
            hashrate = hashrate / 1000;
            i++;
        }
        return hashrate === null ? `0 H/s` : hashrate.toFixed(2) + ' ' + units[i];
    };
    var emaProcess = function(dataObjArray, timePeriods = 12){
        var k = 2/(timePeriods + 1);
        // first item is just the same as the first item in the input
        dataObjArray[0].ema = dataObjArray[0].original;
        let emaArray = [dataObjArray[0]];
        // for the rest of the items, they are computed with the previous one
        for (let i = 1; i < dataObjArray.length; i++) {
            let e = dataObjArray[i].original * k;
            e += emaArray[i - 1].ema * (1 - k);
            dataObjArray[i].ema = e;
            emaArray.push(dataObjArray[i]);
        }
        return dataObjArray;
    };
    var getTransparentHex = function (hex, opacity){
        hex = hex.replace('#','');
        let r = parseInt(hex.substring(0,2), 16);
        let g = parseInt(hex.substring(2,4), 16);
        let b = parseInt(hex.substring(4,6), 16);
        return 'rgba('+r+','+g+','+b+','+opacity/100+')';
    };
    /* START BUILD GRAPH DATA */
    var handleEntry = function (history) {
        let time = history.time * 1000;
        let data = history.data;
        if (!history) {
            return {}
        } else {
            if (skipIndex < skipCap) {
                skipIndex++;
                return {
                    workers: {
                        x: time,
                        y: data.workerCount
                    },
                    blocks: {
                        x: time,
                        y: data.blocks.pending
                    }
                }
            }
            skipIndex = 0;
            return {
                workers: {
                    x: time,
                    y: data.workerCount
                },
                hashrate: {
                    x: time,
                    y: data.hashrate,
                    original: data.hashrate,
                    ema: 0
                },
                blocks: {
                    x: time,
                    y: data.blocks.pending
                }
            }
        }
    };
    var buildGraphData = function (data) {
        var store = {
            workers: {
                label: "Workers",
                pointRadius: 0,
                steppedLine: true,
                borderColor: chartColors[0],
                backgroundColor: getTransparentHex(chartColors[0], 20),
                data: []
            },
            hashrate: {
                label: "Hashrate",
                pointRadius: 1,
                steppedLine: false,
                borderColor: chartColors[1],
                backgroundColor: getTransparentHex(chartColors[1], 20),
                data: []
            },
            blocks: {
                label: "Pending Blocks",
                pointRadius: 0,
                steppedLine: true,
                borderColor: chartColors[2],
                backgroundColor: getTransparentHex(chartColors[2], 20),
                data: []
            }
        };
        let analyzed = handleHistory(store, data.history);
        emaProcess(analyzed.hashrate.data, 24);
        return analyzed;
    };
    var handleHistory = function (store, history) {
        for(let h in poolData.history) {
            if (Object.prototype.hasOwnProperty.call(poolData.history, h)) {
                let entry = history[h];
                let parsed = handleEntry(entry);
                for (let e in parsed) {
                    if (Object.prototype.hasOwnProperty.call(parsed, e)) {
                        let root = store[e];
                        if (root) {
                            root.data.push(parsed[e])
                        }
                    }
                }
            }
        }
        return store;
    };
    /* END BUILD GRAPH DATA */
    /* START BUILD GRAPH OBJECTS */
    var createLineChart = function (id, datasets, beginAtZero = !0, steps = 10, stepValue = 5, callback = function (value) {
        return value
    }) {
        var ctx = $(`#${id}`);
        return new Chart(ctx, {
            type: 'line',
            data: {
                datasets: datasets
            },
            options: {
                scales: {
                    yAxes: [{
                        gridLines: {
                            color: "rgba(100, 100, 100, 0.1)"
                        },
                        ticks: {
                            beginAtZero: beginAtZero,
                            steps: steps,
                            stepValue: stepValue,
                            callback: callback
                        }
                    }],
                    xAxes: [{
                        type: 'time',
                        distribution: 'series',
                        gridLines: {
                            display: !1,
                        },
                        ticks: {
                            source: 'labels',
                            steps: 10,
                            stepValue: 1
                        }
                    }]
                }
            }
        })
    }
    var buildGraphs = function(data) {
        try {
            charts.workers = createLineChart('pool-chart-workers', [data.workers], true, 1, 2, (value) => {
                if (value == 0) {
                    return value
                } else {
                    let floor = Math.floor(value);
                    return floor <= 0 ? '' : floor
                }
            });
            charts.hashrate = createLineChart('pool-chart-hashrate', [data.hashrate], !0, 10, 5, (value) => {
                return getHashrateString(value)
            });
            //charts.workers = buildWorkerChart();
        } catch (e) {
            throw new Error(e)
        }
        return true;
    }
    /* END BUILD GRAPH OBJECTS */

    // grab initial stats
    $.getJSON(`/api/pool_stats?${_pool}`, function (data) {
        //set pool data to variable
        poolData = data;
        graphData = buildGraphData(data);
        buildGraphs(graphData);
    });
});