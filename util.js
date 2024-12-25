
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

const timeToSeconds = (timeStr) => {
    try {
        const [hours, minutes, seconds] = timeStr.split(':').map(Number);
        return (hours * 3600) + (minutes * 60) + (seconds || 0);
    } catch (error) {
        console.error(`Invalid time format: ${timeStr}`);
        return 0;
    }
};


const timestampToTimeString = (timestamp) => {
    const date = timestamp.toDate();
    return date.toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
};

const roundTimeToNearestFiveSeconds = (timeStr) => {
    const [hours, minutes, seconds] = timeStr.split(':').map(Number);
    const roundedSeconds = Math.round(seconds / 5) * 5;
    const adjustedMinutes = minutes + Math.floor(roundedSeconds / 60);
    const finalSeconds = roundedSeconds % 60;
    const adjustedHours = hours + Math.floor(adjustedMinutes / 60);
    const finalMinutes = adjustedMinutes % 60;

    return `${String(adjustedHours).padStart(2, '0')}:${String(finalMinutes).padStart(2, '0')}:${String(finalSeconds).padStart(2, '0')}`;
};

const parseBPS = (bpsString) => {
    if (!bpsString) return 0;
    try {
        return parseFloat(bpsString.replace(' MB', '')) || 0;
    } catch (e) {
        return 0;
    }
};

const parsePPS = (ppsString) => {
    if (!ppsString) return 0;
    try {
        return parseFloat(ppsString.replace('k', '')) || 0;
    } catch (e) {
        return 0;
    }
};



module.exports = {
    parseOutput,
    parseBPS,
    parsePPS,
    formatIpAddress,
    timeToSeconds,
    timestampToTimeString,
    roundTimeToNearestFiveSeconds
}