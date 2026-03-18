// cookie Helpers
function setCookie(name, value, hours) {
    let expires = "";
    if (hours) {
        let date = new Date();
        date.setTime(date.getTime() + (hours * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "")  + expires + "; path=/";
}

function getCookie(name) {
    let nameEQ = name + "=";
    let ca = document.cookie.split(';');
    for(let i=0;i < ca.length;i++) {
        let c = ca[i];
        while (c.charAt(0)==' ') c = c.substring(1,c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length,c.length);
    }
    return null;
}

// generic JWT decoder
function decodeJWT(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

// decode JWT (id_token) to extract the user's game name safely
function extractAccountName(idToken) {
    const decoded = decodeJWT(idToken);
    if (decoded && decoded.acct && decoded.acct.game_name) {
        return decoded.acct.game_name + "#" + decoded.acct.tag_line;
    }
    return "Player";
}

function showShopFlow(accessToken, accountName) {
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("logged-in-section").style.display = "block";
    document.getElementById("shop-section").style.display = "block";
    document.getElementById("account-name-text").innerText = "Welcome, " + accountName;

    fetchShop(accessToken);
}

// logic to logout
function logout() {
    document.cookie = "riot_access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = "riot_account_name=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

    document.getElementById("logged-in-section").style.display = "none";
    document.getElementById("shop-section").style.display = "none";
    document.getElementById("auth-section").style.display = "block";
    document.getElementById("shop-items").innerHTML = "";
}

// 1. check if the URL has a hash containing tokens OR if we have cookies
function checkLoginRedirect() {
    const hash = window.location.hash.substring(1);
    let savedToken = getCookie("riot_access_token");
    let savedName = getCookie("riot_account_name");

    if (hash && hash.includes("access_token")) {
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const idToken = params.get("id_token");

        if (accessToken) {
            let accountName = "Unknown Player";
            if (idToken) {
                accountName = extractAccountName(idToken);
            }

            // store both in cookies for 1 hour (riot tokens typically expire in an hour)
            setCookie("riot_access_token", accessToken, 1);
            setCookie("riot_account_name", accountName, 1);

            // clear the giant hash from the URL bar to make the website look clean
            history.replaceState(null, null, window.location.pathname);

            showShopFlow(accessToken, accountName);
        }
    } else if (savedToken) {
        // bypass login
        showShopFlow(savedToken, savedName || "Saved Player");
    }
}

function handleManualToken() {
    const tokenInput = document.getElementById("token-url-input");
    const tokenValue = tokenInput ? tokenInput.value.trim() : "";
    if (!tokenValue) {
        alert("Paste the redirected URL (or just the # fragment) after Riot login.");
        return;
    }

    const fragment = tokenValue.startsWith("#")
        ? tokenValue.slice(1)
        : (tokenValue.includes("#") ? tokenValue.split("#").slice(1).join("#") : tokenValue);

    if (!fragment || !fragment.includes("access_token=")) {
        alert("Invalid redirect data. It must include access_token in the URL hash.");
        return;
    }

    window.location.hash = fragment;
    checkLoginRedirect();
}

let globalSkinsCache = {}; // Global cache for variants modal

// 2. shop fetching logic
async function fetchShop(accessToken) {
    const shopDiv = document.getElementById("shop-items");
    shopDiv.innerHTML = "<h3 style='text-align: center;'>Loading store data...</h3>";
    
    try {
        // 1. get user ID
        const decodedToken = decodeJWT(accessToken);
        if (!decodedToken || !decodedToken.sub) throw new Error("Invalid access token structure.");
        const userId = decodedToken.sub;

        // 2. get entitlements token
        const entRes = await fetch("https://entitlements.auth.riotgames.com/api/token/v1", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        
        if (!entRes.ok) {
            if (entRes.status === 401 || entRes.status === 403) logout();
            throw new Error("Failed to fetch entitlements token. Token may be expired.");
        }
        const entData = await entRes.json();
        const entToken = entData.entitlements_token;

        // 3. get client version (using public API)
        const verRes = await fetch("https://valorant-api.com/v1/version");
        const verData = await verRes.json();
        const clientVersion = verData.data.riotClientVersion;

        // 4. fetch the shop (using EU region as base default like the backend did)
        const platform = "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9";
        
        const shopRes = await fetch(`https://pd.eu.a.pvp.net/store/v3/storefront/${userId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'X-Riot-Entitlements-JWT': entToken,
                'X-Riot-ClientPlatform': platform,
                'X-Riot-ClientVersion': clientVersion,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        
        if (!shopRes.ok) {
            shopDiv.innerHTML = "<h3 style='color: var(--val-red); text-align: center;'>Session expired or invalid token.</h3>";
            if (shopRes.status === 401 || shopRes.status === 403) logout();
            return;
        }
        
        const shopData = await shopRes.json();

        // 5. fetch skins DB to map IDs to images and variants
        const skinsRes = await fetch("https://valorant-api.com/v1/weapons/skins");
        const skinsData = await skinsRes.json();
        
        skinsData.data.forEach(skin => {
            if (skin.levels && skin.levels.length > 0) {
                skin.levels.forEach(lvl => {
                    globalSkinsCache[lvl.uuid] = skin;
                });
            }
        });

        // 6. render the raw HTML shop
        let html = "<div class='shop-grid'>";

        const storeOffers = shopData.SkinsPanelLayout?.SingleItemStoreOffers || [];
        storeOffers.forEach(offer => {
            let itemId = (offer.Rewards && offer.Rewards.length > 0) ? offer.Rewards[0].ItemID : null;
            let costObj = offer.Cost || {};
            let vpCost = costObj["85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741"] || 0;
            
            let skinName = "Unknown Skin";
            let skinIcon = "";

            if (itemId && globalSkinsCache[itemId]) {
                let skinObj = globalSkinsCache[itemId];
                skinName = skinObj.displayName;
                skinIcon = skinObj.displayIcon || (skinObj.levels[0] ? skinObj.levels[0].displayIcon : "");
            }

            html += `
            <div class="shop-card" onclick="openSkinModal('${itemId}', ${vpCost})">
                <div class="card-image-wrap">
                    <img src="${skinIcon}" alt="${skinName}" onerror="this.style.display='none'">
                </div>
                <div class="card-info">
                    <div class="skin-name">${skinName}</div>
                    <div class="price-row" style="justify-content: space-between; width: 100%;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <img src="css/vp.png" alt="VP" style="width: 16px; height: 16px; object-fit: contain;">
                            <span class="vp-cost">${vpCost}</span>
                        </div>
                        <span class="eur-cost" style="font-size: 0.8rem; color: var(--val-gray);">${(vpCost / 100).toFixed(2)}€</span>
                    </div>
                </div>
            </div>`;
        });

        html += "</div>";
        shopDiv.innerHTML = html;

    } catch (error) {
        shopDiv.innerHTML = `<h3 style='color: var(--val-red); text-align: center;'>Error syncing with Riot: ${error.message}</h3>`;
        console.error(error);
    }
}

// run check when page loads
window.onload = checkLoginRedirect;
// --- Modal logic ---
function openSkinModal(levelId, vpCost = 0) {
    const skin = globalSkinsCache[levelId];
    if (!skin) return;

    document.getElementById('skin-modal').style.display = 'flex';
    document.getElementById('modal-skin-name').innerText = skin.displayName;
    document.getElementById('modal-right').style.display = 'none';

    // Populate modal stats
    if (document.getElementById('modal-vp-cost')) {
        document.getElementById('modal-vp-cost').innerText = vpCost;
        document.getElementById('modal-eur-cost').innerText = (vpCost / 100).toFixed(2) + "€";
    }

    const variantsContainer = document.getElementById('modal-variants');
    variantsContainer.innerHTML = '';

    // Preload images to remove blinking
    if (skin.chromas) {
        skin.chromas.forEach(chroma => {
            const preloadImg = new Image();
            preloadImg.src = chroma.fullRender || chroma.displayIcon || '';
        });
    }

    // Play base video or show base image first
    if (skin.chromas && skin.chromas.length > 0) {
        changeVariant(skin.chromas[0], skin);

        if (skin.chromas.length <= 1) {
            variantsContainer.innerHTML = "<div style='color: var(--val-gray); font-size: 14px;'>No variants</div>";
        } else {
            skin.chromas.forEach((chroma, index) => {
                const swatch = document.createElement('div');
                swatch.className = 'variant-swatch' + (index === 0 ? ' active' : '');

                // Some chromas don't have swatches, fallback to display icon or just a color
                if (chroma.swatch) {
                    swatch.innerHTML = "<img src='" + chroma.swatch + "' alt='Swatch'>";
                } else if (chroma.displayIcon) {
                    swatch.innerHTML = "<img src='" + chroma.displayIcon + "' alt='Icon'>";
                } else {
                    swatch.innerHTML = "<div style='width:100%;height:100%;background:var(--val-red);'></div>";
                }

                swatch.onclick = function() {
                    document.querySelectorAll('.variant-swatch').forEach(el => el.classList.remove('active'));
                    swatch.classList.add('active');
                    changeVariant(chroma, skin);
                };

                variantsContainer.appendChild(swatch);
            });
        }
    } else if (skin.levels && skin.levels.length > 0) {
        changeVariant(skin.levels[0], skin);
        variantsContainer.innerHTML = "<div style='color: var(--val-gray); font-size: 14px;'>No variants</div>";
    }
}

let currentVideoUrl = null;

function changeVariant(chromaData, skin) {
    const videoObj = document.getElementById('modal-video');
    const imgObj = document.getElementById('modal-image');

    // Prioritize high-res full render over just the icon
    const newImgSrc = chromaData.fullRender || chromaData.displayIcon || '';

    // Only update image src if it changed to prevent flashing
    if (imgObj.getAttribute('src') !== newImgSrc && newImgSrc !== '') {
        imgObj.style.display = 'block';
        imgObj.setAttribute('src', newImgSrc);
    }

    // Fallback: If chroma doesn't have a video, check the skin's levels for the highest available video
    let newVideoUrl = chromaData.streamedVideo || null;
    if (!newVideoUrl && skin && skin.levels) {
        for (let i = skin.levels.length - 1; i >= 0; i--) {
            if (skin.levels[i].streamedVideo) {
                newVideoUrl = skin.levels[i].streamedVideo;
                break;
            }
        }
    }

    currentVideoUrl = newVideoUrl;
    
    document.getElementById('modal-right').style.display = 'flex'; // Right panel always visible now for stats

    const wrapper = document.getElementById('video-wrapper');
    const placeholder = document.getElementById('no-video-placeholder');
    if (wrapper) wrapper.style.display = 'flex';

    if (currentVideoUrl) {
        if (placeholder) placeholder.style.display = 'none';
        videoObj.style.display = 'block';

        // Prevent blinking by only changing the source if the video actually changed
        if (videoObj.getAttribute('src') !== currentVideoUrl) {
            videoObj.pause();
            videoObj.setAttribute('src', currentVideoUrl);
            videoObj.load();
            videoObj.muted = false; // ensure audio is physically on
            videoObj.volume = 0.5;  // 50% default volume so it doesn't blast ears

            // Force the first frame to render so it isn't transparent/black
            videoObj.play().then(() => {
                videoObj.pause();
                videoObj.currentTime = 0;
            }).catch(e => console.log('Video autoplay blocked, staying paused', e));
        }
    } else {
        if (placeholder) placeholder.style.display = 'flex';
        videoObj.style.display = 'none';
        videoObj.pause();
        videoObj.removeAttribute('src');
        videoObj.load();
    }
}

function closeModal() {
    document.getElementById('skin-modal').style.display = 'none';
    const videoObj = document.getElementById('modal-video');
    videoObj.pause();
    videoObj.removeAttribute('src');
    videoObj.load();
}

// Close modal on click outside
window.onclick = function(event) {
    const modal = document.getElementById('skin-modal');
    if (event.target == modal) {
        closeModal();
    }
}
