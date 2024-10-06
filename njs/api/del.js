// Function to delete upstreams
function deleteUpstreams(req, upstreamId, upstreamName) {    
    try {

        if (upstreamName.get(upstreamId) == undefined) {
            ingress.responseHandling(req, 404, 'Upstream ID ' + upstreamId + ' does not exist');
            return;
        }

        // Delete the upstream from the shared dictionary
        upstreamName.delete(upstreamId);

        if (upstreamName.get(upstreamId) == undefined) {
            ingress.responseHandling(req, 204, 'Deleted');
        } else {
            ngx.log(ngx.ERR, 'Failed to delete upstream with ID: ' + upstreamId);
            ingress.responseHandling(req, 500, 'Failed to delete upstream');
        }

    } catch (e) {
        ngx.log(ngx.ERR, 'Error processing DELETE request: ' + e.message);
        ingress.responseHandling(req, 500, 'Could not delete upstream');
        return;
    }
}

export default {
    deleteUpstreams
}