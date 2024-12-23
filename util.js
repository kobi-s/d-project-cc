
function parseOutput(output) {
    if (!Array.isArray(output)) {
        return [];
    }
    
    return output.map(line => {
        // Extract time from the timestamp
        const timeMatch = line.match(/\[(\d{2}:\d{2}:\d{2})/);
        const time = timeMatch ? timeMatch[1] : null;

        // Remove ANSI color codes
        const cleanLine = line.replace(/\x1B\[\d+m/g, '');

        // Extract values using regex
        const targetMatch = cleanLine.match(/Target:\s*([^,]+)/);
        const portMatch = cleanLine.match(/Port:\s*(\d+)/);
        const methodMatch = cleanLine.match(/Method:\s*(\w+)/);
        const ppsMatch = cleanLine.match(/PPS:\s*([\d.]+k)/);
        const bpsMatch = cleanLine.match(/BPS:\s*([\d.]+)\s*MB/);
        const percentageMatch = cleanLine.match(/(\d+)%/);

        return {
            time: time,
            Target: targetMatch ? targetMatch[1].trim() : null,
            Port: portMatch ? parseInt(portMatch[1]) : null,
            Method: methodMatch ? methodMatch[1] : null,
            PPS: ppsMatch ? ppsMatch[1] : null,
            BPS: bpsMatch ? `${bpsMatch[1]} MB` : null,
            percentage: percentageMatch ? `${percentageMatch[1]}%` : null
        };
    });
}

// const output = [
//     'ERROR: [19:32:49 - DEBUG] \x1B[93mTarget:\x1B[94m 1.1.1.1,\x1B[93m Port:\x1B[94m 53,\x1B[93m Method:\x1B[94m UDP\x1B[93m PPS:\x1B[94m 54.06k,\x1B[93m BPS:\x1B[94m 55.36 MB / 95%\x1B[0m',
//     'ERROR: [19:32:50 - DEBUG] \x1B[93mTarget:\x1B[94m 1.1.1.1,\x1B[93m Port:\x1B[94m 53,\x1B[93m Method:\x1B[94m UDP\x1B[93m PPS:\x1B[94m 53.52k,\x1B[93m BPS:\x1B[94m 54.81 MB / 96%\x1B[0m',
//     'ERROR: [19:32:51 - DEBUG] \x1B[93mTarget:\x1B[94m 1.1.1.1,\x1B[93m Port:\x1B[94m 53,\x1B[93m Method:\x1B[94m UDP\x1B[93m PPS:\x1B[94m 53.87k,\x1B[93m BPS:\x1B[94m 55.16 MB / 97%\x1B[0m',
//     'ERROR: [19:32:52 - DEBUG] \x1B[93mTarget:\x1B[94m 1.1.1.1,\x1B[93m Port:\x1B[94m 53,\x1B[93m Method:\x1B[94m UDP\x1B[93m PPS:\x1B[94m 53.69k,\x1B[93m BPS:\x1B[94m 54.98 MB / 98%\x1B[0m',
//     'ERROR: [19:32:53 - DEBUG] \x1B[93mTarget:\x1B[94m 1.1.1.1,\x1B[93m Port:\x1B[94m 53,\x1B[93m Method:\x1B[94m UDP\x1B[93m PPS:\x1B[94m 53.42k,\x1B[93m BPS:\x1B[94m 54.70 MB / 99%\x1B[0m'
//   ]

// const result = parseOutput(output);
// console.log(JSON.stringify(result, null, 2));



module.exports = {
    parseOutput
}