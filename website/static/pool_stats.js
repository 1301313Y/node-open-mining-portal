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

    var pollWorkerCount = 0;

    var poolData;

    var charts = {
        workers: undefined,
        hashrate: undefined,
        distWorkers: undefined,
        distHashrate: undefined
    };

    var processedData = {
        workers: [],
        hashrate: [],
        blocks: []
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
    function handleHashrateDataEntry(history) {
        //faux model
        let entry = {
            x: history.time,
            y: history.data.hashrate,
            original: history.data.hashrate,
            ema: 0,
        };
        //add entry
        processedData.hashrate.push(entry);
    }

    function handleWorkerDataEntry(history) {
        //faux model
        let entry = {
            x: history.time,
            y: history.data.workerCount
        };
        if(entry.y > pollWorkerCount) {
            pollWorkerCount = entry.y;
        }
        //add entry
        processedData.workers.push(entry);
    }

    function finalizeHashrateDataBuild() {
        emaProcess(processedData.hashrate, 24);
        let index = graphData.hashrate.length;
        let color = chartColors[index % chartColors.length];
        graphData.hashrate.push({
            label: "Hashrate",
            data: processedData.hashrate.map((e) => { return { x: e.x, y: e.ema }; }),
            borderColor: color,
            backgroundColor: getTransparentHex(color, 20),
        });
    }

    function finalizeWorkerDataBuild() {
        let index = graphData.workers.length;
        let color = chartColors[index % chartColors.length];
        graphData.workers.push({
            label: "Workers",
            pointRadius: 0,
            steppedLine: true,
            data: processedData.workers,
            borderColor: color,
            backgroundColor: getTransparentHex(color, 20),
        });
    }

    function finalizeGraphDataBuild() {
        finalizeHashrateDataBuild();
        finalizeWorkerDataBuild();
    }

    function buildGraphData() {
        try {
            for(let h in poolData.history) {
                if (Object.prototype.hasOwnProperty.call(poolData.history, h)) {
                    let history = poolData.history[h];
                    handleWorkerDataEntry(history);
                    //Make sure to add items to be spaced in else statement of this condition
                    if(skipIndex < skipCap){
                        skipIndex++;
                    } else {
                        handleHashrateDataEntry(history);
                        skipIndex = 0;
                    }
                }
            }
            finalizeGraphDataBuild();
        } catch (e) {
            throw new Error(e)
        }
        return true;
    }
    /* END BUILD GRAPH DATA */

    /* START BUILD GRAPH OBJECTS */
    var buildHashrateChart = function() {
        var ctx = $('#pool-chart-hashrate');
        return new Chart(ctx, {
            // The type of chart we want to create
            type: 'line',
            data: {
                datasets: graphData.hashrate
            },
            // Configuration options go here
            options: {
                tooltips: {
                    callbacks: {
                        title: function(tooltipItem) {
                            return Date(tooltipItem).toLocaleString();
                        },
                        label: function(tooltipItem) {
                            return getHashrateString(tooltipItem.yLabel);
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
                            callback: function(value) {
                                return getHashrateString(value);
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

    function buildWorkerChart() {
        var ctx = $('#pool-chart-workers');
        return new Chart(ctx, {
            type: 'line',
            data: {
                datasets: graphData.workers
            },
            // Configuration options go here
            options: {
                responsive: true,
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
                            max: Math.floor(-((0.01 * pollWorkerCount) - 10)) + 1
                        }
                    }],
                    xAxes: [{
                        type: 'time',
                        distribution: 'series',
                        gridLines: {
                            display: false
                        },
                        ticks: {
                            source: 'labels'
                        }
                    }]
                }
            }
        });
    }

    var buildGraphs = function() {
        try {
            charts.hashrate = buildHashrateChart();
            charts.workers = buildWorkerChart();
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
        //build graph data
        if(buildGraphData()) {
            buildGraphs();
        }
    });
});