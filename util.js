
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

const formatIpAddress = (ip) => {
    // Check if it's an IPv4 mapped to IPv6 format
    if (ip.includes('::ffff:')) {
      return ip.split('::ffff:')[1];
    }
    return ip;
  };


module.exports = {
    parseOutput,
    formatIpAddress
}