const http = require('http');

// Create a server object:
http.createServer(function (req, res) {
    // Set the response header
    res.writeHead(200, { 'Content-Type': 'application/json' });

    if (req.method === "POST") {
        console.log('POST /');

        let body = '';
        req.on('data', function (data) {
            body += data;
        });

        req.on('end', function () {
            console.log('Received body:', body);

            // After processing the POST data, you can send a response
            let msg = createMessage();
            let jsonStr = JSON.stringify(msg);
            res.write(jsonStr); // Write a response to the client
            res.end(); // End the response
        });

    } else {
        console.log('GET /');

        // Handle GET request
        let msg = createMessage();
        let jsonStr = JSON.stringify(msg);
        res.write(jsonStr); // Write a response to the client
        res.end(); // End the response
    }

}).listen(3001, '0.0.0.0', () => {
    console.log('Server is listening on port 3000');
});

function createMessage() {
    const date = new Date();

    // Convert to UTC+5:30 (IST)
    const options = {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
    };

    // Format the date in ISO-like format with IST offset
    const formattedDate = date.toLocaleString('en-IN', options)
        .replace(/(\d+)\/(\d+)\/(\d+), (\d+:\d+:\d+)/, (_, d, m, y, t) => {
            return `${y}-${m}-${d}T${t}.000+05:30`;
        });
    return {
        message: 'Hello World!',
        time: formattedDate // Use current time in ISO format
    };
}
