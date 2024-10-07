let count = ngx.shared.count; // Shared dictionary for counting requests and other counters

// Function to get the upstream for the request
function get_upstream(req) {
    let upstreamName = req.variables['upstream_name'];
    upstreamName = ngx.shared[upstreamName];

    // Initialize upstreams for this handler if they haven't been loaded yet
    if (!count.get(upstreamName)) {
        handler.load_upstreams(req, upstreamName);
        ngx.log(ngx.INFO, "Read from fs");
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
