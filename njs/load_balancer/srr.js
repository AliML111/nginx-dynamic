var count = ngx.shared.count; // Shared dictionary for counting requests and other counters

// Function to get the upstream for the request
function get_upstream(req) {
    var upstreamName = req.variables['upstream_name'];
    upstreamName = ngx.shared[upstreamName];

    // Initialize upstreams for this handler if they haven't been loaded yet
    if (!count.get(upstreamName.name)) {
        handler.load_upstreams(req, upstreamName);
    }

    // Get the list of upstreams from the shared dictionary
    var items = upstreamName.items();
    var numUpstreams = items.length;

    // Return error if no upstreams are available
    if (numUpstreams === 0) {
        invalid_backend(req, 503);
        return;
    }

    // Atomic operation to retrieve and increment index and weight in one step
    var indexKey = 'index';
    var weightKey = 'weight';

    // Calculate the round-robin index and increment the counters
    var roundRobinIndex = count.incr(indexKey, 1, 0) % numUpstreams;
    var weightCounter = count.incr(weightKey, 1, 0);

    // Get the current upstream item based on the round-robin index
    var currentItem = JSON.parse(items[roundRobinIndex][1]);

    var backend = currentItem.endpoint;
    var backendWeight = currentItem.weight;

    // Increment request count for the backend
    count.incr(backend, 1, 0);

    // Reset weight counter if it exceeds the backend weight
    if (weightCounter >= backendWeight) {
        count.set(weightKey, 0);
    }

    // Optionally log the selected backend (commented out)
    // ngx.log(ngx.ERR, 'Selected backend: ' + backend + ' at index: ' + roundRobinIndex +
    //     ', weight counter: ' + weightCounter + ', backend weight: ' + backendWeight +
    //     ', number of reqs: ' + reqCounter);

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
