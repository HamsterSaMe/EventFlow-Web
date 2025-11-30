// Connect to Socket.IO server
const socket = io();

let uploadedLinks = [];

// Listen for link updates from server
socket.on('linksUpdated', (links) => {
    console.log('📩 Received links update:', links);
    uploadedLinks = links || [];
    displayClientLinks();
});

// Display links in the card-style format
function displayClientLinks() {
    const linksContainer = document.getElementById('linksContainer');
    
    if (!linksContainer) {
        console.error('Links container not found');
        return;
    }

    if (uploadedLinks.length === 0) {
        linksContainer.innerHTML = `
            <div class="empty-state">
                <p>No links available yet.</p>
            </div>
        `;
        return;
    }

    // Create card-style links
    linksContainer.innerHTML = uploadedLinks.map(link => {
        const hasBg = !!link.backgroundPath;
        const hasIcon = !!link.iconPath;
        
        let bgHtml = '';
        if (hasBg) {
            bgHtml = `<img src="${link.backgroundPath}" class="link-bg">`;
        }

        let iconHtml = '';
        if (hasIcon) {
            iconHtml = `<img src="${link.iconPath}">`;
        } else {
            iconHtml = '🔗';
        }

        return `
        <a href="${link.url}" target="_blank" class="link-card ${hasBg ? 'has-bg' : ''}">
            ${bgHtml}
            <div class="link-content">
                <div class="link-icon">
                    ${iconHtml}
                </div>
                <span class="link-title">${link.title}</span>
            </div>
        </a>
    `}).join('');
}

// Request current links on page load
socket.emit('requestLinks');

console.log('✅ Link client script loaded');