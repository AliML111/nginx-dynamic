var fs = require('fs');

function writeFile(s, upstreamName) {
        let STORAGE = "/etc/nginx/njs/stream_upstreams1.js";
        upstreamName = upstreamName.items(); // Get the items from the shared dictionary

        // Initialize an array to store the final objects
        let result = [];

        // Iterate over the shared dictionary items
        for (let key in upstreamName) {
            // Since `shared.items()` returns an object where keys are indexes, and values are the stored data, 
            // we can directly parse the values assuming they are in JSON format.
            try {
                result.push(JSON.parse(upstreamName[key][1]));  // Parse the JSON string and add to result
            } catch (e) {
                s.error(`Error parsing JSON for key ${key}: ${e.message}`);
            }
        }

        // Convert the result array to a JSON string to write to the file
        let resultString = JSON.stringify(result);

        // Write the result to the file
        fs.writeFileSync(STORAGE, resultString);

        // Optionally, log the result or return it as a response
        s.error(resultString);

}

function readFile(s) {
    // s.on('upload', function() {

        let upstreamName = s.variables['upstream_name'];
        upstreamName = ngx.shared[upstreamName];
        let count = s.variables['counter_name'];
        count = ngx.shared[count];

        let fileContent = {};
        let STORAGE = "/etc/nginx/njs/stream_upstreams1.js";

        try {
            // Read the file content
            fileContent = fs.readFileSync(STORAGE, 'utf8');  // 'utf8' to read as a string

        } catch (e) {
            s.error(`Error reading file: ${e.message}`);
            return;
        }
        handler.load_stream_upstreams(s, upstreamName, count, fileContent);
        // s.error("Read from fs stream");

        // Optionally, log the result or return it as a response
        // s.error(fileContent);

    //     s.off('upload');
    // });

}

function preload(s){
    let upstreamName = s.variables['upstream_name'];
    upstreamName = ngx.shared[upstreamName];
    let count = s.variables['counter_name'];
    count = ngx.shared[count];
    handler.load_stream_upstreams(s, upstreamName, count);
    writeFile(s, upstreamName);

}

export default {writeFile, readFile, preload};
