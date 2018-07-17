var skipCap = 5; // 5 mins as data is collected every 60 seconds
var skipIndex = skipCap; //include first entry

var pollWorkerCount = 0;

var poolData;

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

function handleMaxUser(count) {
  
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
    applyExponentialMovingAVG(processedData.hashrate, 24);
    let index = graphData.hashrate.length;
    let color = chartColors[index % chartColors.length];
    graphData.hashrate.push({
        label: "Hashrate",
        data: processedData.hashrate.map((e) => { return { x: e.x, y: e.ema }; }),
        borderColor: color,
        backgroundColor: convertHex(color, 20),
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
        backgroundColor: convertHex(color, 20),
    });
}

function finalizeGraphDataBuild() {
    finalizeHashrateDataBuild();
    finalizeWorkerDataBuild();
}

function buildGraphData() {
    for(h in poolData.history) {
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
    finalizeGraphDataBuild();
}
/* END BUILD GRAPH DATA */

/* START BUILD GRAPH OBJECTS */
function buildHashrateChart() {
    var ctx = $('#pool-chart-hashrate');
    workerHashrateChart = new Chart(ctx, {
        // The type of chart we want to create
        type: 'line',
        data: {
            datasets: graphData.hashrate
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

function buildWorkerChart() {
    var ctx = $('#pool-chart-workers');
    workerHashrateChart = new Chart(ctx, {
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

function buildGraphs() {
    buildHashrateChart();
    buildWorkerChart();
}
/* END BUILD GRAPH OBJECTS */

// grab initial stats
$.getJSON(`/api/pool_stats?${_pool}`, function (data) {
    //set pool data to variable
    poolData = data;
    //build graph data
    buildGraphData();
    buildGraphs();
});