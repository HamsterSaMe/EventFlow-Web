const socket = io();
const brochureList = document.getElementById('brochureList');

function renderBrochures(list) {
    brochureList.innerHTML = '';
    
    if (!list || list.length === 0) {
        brochureList.innerHTML = '<div style="padding: 20px; color: #666;">Waiting for host to upload...</div>';
        return;
    }

    list.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = 'display: flex; align-items: center; justify-content: space-between; background: #f9ffff; padding: 15px; border-radius: 8px; border: 1px solid #eee; text-align: left; box-shadow: 0 2px 4px rgba(0,0,0,0.05);';
        
        const info = document.createElement('div');
        info.style.cssText = 'display: flex; align-items: center; gap: 15px; overflow: hidden;';
        
        let icon = '📄';
        
        const displayName = item.name || item.url;
        const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '';
        
        info.innerHTML = `
            <span style="font-size: 24px;">${icon}</span> 
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 600; color: #333; word-break: break-word;">${displayName}</span>
                <span style="font-size: 12px; color: #888;">${dateStr}</span>
            </div>
        `;
        
        const btn = document.createElement('button');
        btn.textContent = 'View';
        btn.style.cssText = 'background: #00b0b9; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; white-space: nowrap;';
        btn.onclick = () => {
            const url = item.url;
            window.open(url, '_blank');
        };
        
        div.appendChild(info);
        div.appendChild(btn);
        brochureList.appendChild(div);
    });
}

socket.on('brochureUpdated', (data) => {
  renderBrochures(data);
});

