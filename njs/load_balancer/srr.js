

// Function to get the upstream for the request
function get_upstream(req) {
    let upstreamName = req.variables['upstream_name'];
    upstreamName = ngx.shared[upstreamName];
    let count = req.variables['counter_name'];
    count = ngx.shared[count];

    // Initialize upstreams for this handler if they haven't been loaded yet
    if (count.get(upstreamName) == undefined) {
        let protocol = req.variables['protocol'];
        if (protocol == "TCP" || protocol == "UDP"){
            handler.load_stream_upstreams(req, upstreamName, count);
            disk.writeFile(req, upstreamName);
        } else {
            handler.load_upstreams(req, upstreamName, count);
        }
        ngx.log(ngx.ERR, "Read from fs");
    }

    // Get the list of upstreams from the shared dictionary
    let items = upstreamName.items();
    let numUpstreams = items.length;

    // Return error if no upstreams are available
    if (numUpstreams === 0) {
        invalid_backend(req, 503);
        return;
    }

    // Atomic operation to retrieve and increment index 
    let indexKey = 'index';

    // Calculate the round-robin index and increment the counters
    let roundRobinIndex = count.incr(indexKey, 1, 0) % numUpstreams;

    // Get the current upstream item based on the round-robin index
    let currentItem = JSON.parse(items[roundRobinIndex][1]);

    let backend = currentItem.endpoint;

    // Increment request count for the backend
    count.incr(currentItem.id, 1, 0);

    // Return the selected backend endpoint
    return backend;
    
}

// Function to handle invalid backend cases
function invalid_backend(req, code) {
    req.return(code, 'Invalid Backend');
    req.finish();
    return '@invalid_backend';
}

export default {
    get_upstream
}
