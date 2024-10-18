
// Function to delete upstreams
function delete_upstreams(req, upstreamId, upstreamName, count) {    
    try {
        // Reset the statics like request counter

        if (upstreamId == null){
            let items = upstreamName.items();
            for (let i in items){
                let parsedServer = JSON.parse(items[i][1]);
                count.set(parsedServer.id, 0);
            }
        } else if (upstreamId != null && upstreamName.get(upstreamId) != undefined) {
            upstreamName.delete(upstreamId);
            upstreamName.get(upstreamId) != undefined && handler.response_handler(req, 500, 'Failed to delete upstream');
        } else {
            handler.response_handler(req, 404, 'Upstream ID ' + upstreamId + ' does not exist');
            return;
        }

        // Delete the upstream from the shared dictionary

        handler.response_handler(req, 204);

        disk.writeFile(req, upstreamName);

        ngx.fetch('http://unix:/etc/nginx/dummy.sock');

    } catch (e) {
        ngx.log(ngx.ERR, 'Error processing DELETE request: ' + e.message);
        handler.response_handler(req, 500, 'Could not delete upstream');
        return;
    }
}

export default {
    delete_upstreams
}