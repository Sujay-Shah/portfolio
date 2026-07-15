// app.js - Portfolio & Write-ups Application Core Logic

// ----------------------------------------------------
// 1. DATA CONFIGURATIONS (Project Specifications)
// ----------------------------------------------------
const projectSpecs = {
    usul: {
        title: "Usul 3D Game Engine",
        subtitle: "RHI WITH VULKAN & DX12 BACKENDS // C++20",
        summary: "A from-scratch 3D game engine focusing on modular engine systems and an explicit Render Hardware Interface (RHI) matching modern GPU architectures. Built with C++20, featuring both Vulkan 1.3 and DirectX 12 backends behind a unified API surface, a scene editor, and a WebAssembly port via WebGPU.",
        bullets: [
            "<strong>Multi-API Backend:</strong> Designed a unified RHI layer compiling down to clean Vulkan 1.3 and DirectX 12 calls.",
            "<strong>Explicit Memory Management:</strong> Built-in paging allocators utilizing VMA (Vulkan Memory Allocator) and D3D12MA (D3D12 Memory Allocator) to sub-allocate buffer/texture regions from large driver heaps.",
            "<strong>Multithreaded Recording:</strong> Parallelized command buffer submission by implementing thread-local command context recorders with deferred state committing.",
            "<strong>Resource Barrier Tracking:</strong> Automated layout transitions (e.g., Render_Target to Shader_Resource) by maintaining a runtime state-dependency graph.",
            "<strong>WebAssembly Port:</strong> Engine compiled to WASM via Emscripten with a WebGPU RHI backend, enabling the editor to run directly in the browser."
        ],
        githubUrl: "https://github.com/Sujay-Shah/Usul",
        // Set wasmUrl to the hosted path when ready. null = show 'coming soon' placeholder.
        wasmUrl: "https://usul-build.netlify.app/editor"
    },
    odyssey: {
        title: "3D Game: Odyssey",
        subtitle: "ENGINE ARCHITECT & PRODUCER // TEAM OF 4",
        summary: "A robust custom game codebase featuring deep memory pooling, script bindings, and asset loading pipelines.",
        bullets: [
            "<strong>Custom Resource Manager:</strong> Created a zero-copy asset loading registry utilizing asynchronous file I/O to stream model textures and mesh formats.",
            "<strong>Object Factory & Entity Management:</strong> Developed a factory pattern in C++ allowing dynamic serialization of scene configurations via simple JSON layout files.",
            "<strong>Optimization Passes:</strong> Prevented runtime memory spikes by pre-allocating HUD overlays and loading menus during bootstrap, enforcing a single load per run constraint.",
            "<strong>Scene Level Streamer:</strong> Programmed a volume-based streaming trigger network that pre-caches meshes and buffers of adjacent level sections using double-buffering."
        ],
        githubUrl: "https://github.com/Sujay-Shah/Odyssey",
        videoUrl: "https://github.com/Sujay-Shah/Odyssey/raw/refs/heads/master/Odyssey_video.mp4"
    },
    graphics: {
        title: "3D Graphics Projects",
        subtitle: "DEFERRED RENDERING, RAYTRACING & INVERSE KINEMATICS",
        summary: "Solo programming projects showcasing mathematical optimization, shader design, and complex coordinate rigging.",
        bullets: [
            "<strong>Deferred Shading Pipeline:</strong> Designed a pipeline decomposing geometry rendering into albedo, depth, normal, and roughness G-buffer textures before running lighting passes.",
            "<strong>Raytracer from Scratch:</strong> Programmed an CPU/GPU raytracer supporting reflection vectors, refraction coefficients, shadow casting rays, and ambient occlusion.",
            "<strong>Skeletal Rigging & IK:</strong> Coded an animation module integrating inverse kinematics using the FABRIK algorithm for procedural footing on uneven terrain."
        ],
        codeLang: "glsl",
        codeHeader: "DeferredLighting.frag",
        codeSnippet: `#version 450 core
layout (location = 0) out vec4 FragColor;
layout (binding = 0) uniform sampler2D gPosition;
layout (binding = 1) uniform sampler2D gNormal;
layout (binding = 2) uniform sampler2D gAlbedoSpec;

void main() {
    vec3 fragPos = texture(gPosition, TexCoords).rgb;
    vec3 normal = texture(gNormal, TexCoords).rgb;
    vec3 albedo = texture(gAlbedoSpec, TexCoords).rgb;
    float specular = texture(gAlbedoSpec, TexCoords).a;

    // Deferred light accumulation calculations
    vec3 lighting = albedo * 0.1; // Ambient minimum
    vec3 viewDir = normalize(viewPos - fragPos);
    ...
    FragColor = vec4(lighting, 1.0);
}`
    },
    dryengine: {
        title: "DryEngine & Asteroids",
        subtitle: "CUSTOM 2D ENGINE // C++ // CS529 PROJECT",
        summary: "My first custom 2D game engine written from scratch in C++ for the CS529 course, used to build a complete Asteroids shooter. This was the foundational project that sparked my obsession with engine architecture — every system from the game loop to the collision resolution was hand-rolled.",
        bullets: [
            "<strong>Custom 2D Engine Core:</strong> Designed a game loop, entity manager, and component system from scratch in C++ with no external game libraries.",
            "<strong>Asteroids Gameplay:</strong> Built a fully playable Asteroids clone on top of the engine, complete with collision detection, particle effects, and progressive difficulty.",
            "<strong>Renderer:</strong> Implemented a lightweight 2D sprite and primitive renderer with basic transform hierarchies.",
            "<strong>Input & Physics:</strong> Wrote a simple physics integration for asteroid movement and player thrust with wrap-around screen borders."
        ],
        githubUrl: "https://github.com/Sujay-Shah/DryEngine",
        videoUrl: "https://github.com/Sujay-Shah/DryEngine/assets/16970214/ec661a43-be44-462d-af2e-1584fcf96af8"
    },
    eggnapped: {
        title: "Eggnapped & 2D Engine v2",
        subtitle: "2D ROGUELIKE // CUSTOM C++ ENGINE // TEAM PROJECT",
        summary: "A second attempt at building a 2D engine in C++, this time taken further with a full game built on top of it: Eggnapped — a top-down 2D roguelike featuring permadeath and procedurally generated dungeon layouts. You play as a cartoon bird warrior on a mission to retrieve stolen eggs.",
        bullets: [
            "<strong>Procedural Dungeon Generation:</strong> Implemented a BSP-tree based dungeon generator to create varied, replayable level layouts at runtime.",
            "<strong>Permadeath System:</strong> Designed a save/checkpoint architecture that enforces roguelike permadeath while tracking high scores.",
            "<strong>Entity Component System:</strong> Evolved the engine from DryEngine's simpler approach into a more data-driven ECS, improving flexibility for game-specific logic.",
            "<strong>Game Polish:</strong> Implemented sprite animation state machines, sound integration, and UI overlays (minimap, HUD, death screen)."
        ],
        githubUrl: "https://github.com/Sujay-Shah/Eggnapped",
        videoUrl: "https://github.com/Sujay-Shah/Eggnapped/assets/16970214/55dac628-b4c7-424a-81ba-9c939e90db2c"
    }
};

// ----------------------------------------------------
// 2. INTERACTIVE VERTEX MESH BACKGROUND (Canvas)
// ----------------------------------------------------
const initMeshBackground = () => {
    const canvas = document.getElementById('mesh-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;
    
    let particles = [];
    let mouse = { x: null, y: null, radius: 150 };
    
    // Adjust size on resize
    window.addEventListener('resize', () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        createParticles();
    });
    
    // Mouse interaction events
    window.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    });
    
    window.addEventListener('mouseleave', () => {
        mouse.x = null;
        mouse.y = null;
    });
    
    class Particle {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.baseX = x;
            this.baseY = y;
            this.size = Math.random() * 2 + 1;
            // High-frequency wobble representation
            this.angle = Math.random() * Math.PI * 2;
            this.speed = Math.random() * 0.02 + 0.005;
            this.wobbleRadius = Math.random() * 15 + 5;
        }
        
        draw() {
            ctx.fillStyle = '#00e5ff';
            ctx.shadowBlur = 4;
            ctx.shadowColor = '#00e5ff';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0; // Reset shadow for line rendering efficiency
        }
        
        update() {
            // Idle orbital float
            this.angle += this.speed;
            let targetX = this.baseX + Math.cos(this.angle) * this.wobbleRadius;
            let targetY = this.baseY + Math.sin(this.angle) * this.wobbleRadius;
            
            // Mouse gravity warp representation
            if (mouse.x !== null && mouse.y !== null) {
                let dx = mouse.x - this.x;
                let dy = mouse.y - this.y;
                let distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < mouse.radius) {
                    const force = (mouse.radius - distance) / mouse.radius;
                    // Attract nodes slightly towards cursor
                    targetX += (dx / distance) * force * 40;
                    targetY += (dy / distance) * force * 40;
                }
            }
            
            this.x += (targetX - this.x) * 0.1;
            this.y += (targetY - this.y) * 0.1;
        }
    }
    
    const createParticles = () => {
        particles = [];
        // Calculate appropriate grid density based on screen size
        const numParticles = Math.min(60, Math.floor((width * height) / 25000));
        for (let i = 0; i < numParticles; i++) {
            particles.push(new Particle(
                Math.random() * width,
                Math.random() * height
            ));
        }
    };
    
    const animate = () => {
        ctx.clearRect(0, 0, width, height);
        
        // Draw GPU-grid styling background
        drawBackgroundGrid();
        
        // Update & Render Nodes
        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();
        }
        
        // Render Node Connections (creating a 3D vertex mesh pattern)
        drawConnections();
        
        requestAnimationFrame(animate);
    };
    
    const drawBackgroundGrid = () => {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.01)';
        ctx.lineWidth = 1;
        const gridSpacing = 80;
        
        for (let x = 0; x < width; x += gridSpacing) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += gridSpacing) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
    };
    
    const drawConnections = () => {
        const maxDist = 180;
        ctx.lineWidth = 0.8;
        
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                let dx = particles[i].x - particles[j].x;
                let dy = particles[i].y - particles[j].y;
                let distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < maxDist) {
                    let alpha = (maxDist - distance) / maxDist * 0.15;
                    ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }
    };
    
    createParticles();
    animate();
};

// ----------------------------------------------------
// 3. TAB NAVIGATION (SPA ROUTING)
// ----------------------------------------------------
const switchTab = (tabId) => {
    // Update active tab contents
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === tabId) {
            content.classList.add('active');
        }
    });
    
    // Update main header nav elements active styling
    const navItems = document.querySelectorAll('.nav-item, .mobile-nav-item');
    navItems.forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-tab') === tabId) {
            item.classList.add('active');
        }
    });
    
    // Scroll window smoothly to header top
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

const handleHashRouting = () => {
    const hash = window.location.hash.substring(1);
    const validTabs = ['home', 'experience', 'projects', 'writeups'];
    
    if (validTabs.includes(hash)) {
        switchTab(hash);
    } else {
        // Default fallback route
        window.location.hash = '#home';
    }
};

// Setup Navigation Events
const initNavEvents = () => {
    const navItems = document.querySelectorAll('.nav-item, .mobile-nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            // Let the hashchange event handle the tab switching
            closeMobileMenu();
        });
    });
    
    // Mobile navigation toggle
    const toggleBtn = document.querySelector('.mobile-menu-toggle');
    const mobileNav = document.querySelector('.mobile-nav');
    const overlay = document.querySelector('.mobile-nav-overlay');
    
    if (toggleBtn && mobileNav && overlay) {
        toggleBtn.addEventListener('click', () => {
            const isOpen = mobileNav.classList.contains('open');
            if (isOpen) {
                closeMobileMenu();
            } else {
                mobileNav.classList.add('open');
                overlay.style.display = 'block';
                toggleBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            }
        });
        
        overlay.addEventListener('click', closeMobileMenu);
    }
    
    window.addEventListener('hashchange', handleHashRouting);
};

const closeMobileMenu = () => {
    const mobileNav = document.querySelector('.mobile-nav');
    const overlay = document.querySelector('.mobile-nav-overlay');
    const toggleBtn = document.querySelector('.mobile-menu-toggle');
    
    if (mobileNav && overlay && toggleBtn) {
        mobileNav.classList.remove('open');
        overlay.style.display = 'none';
        toggleBtn.innerHTML = '<i class="fa-solid fa-bars"></i>';
    }
};

// ----------------------------------------------------
// 4. TIMELINE EXPANSION (Work Experience)
// ----------------------------------------------------
const toggleTimelineDetail = (cardElement) => {
    // Toggle class expanded
    cardElement.classList.toggle('expanded');
    
    // Optional: Close other expanded items for a clean accordion effect
    const allContents = document.querySelectorAll('.timeline-content');
    allContents.forEach(content => {
        if (content !== cardElement && content.classList.contains('expanded')) {
            content.classList.remove('expanded');
        }
    });
};

// ----------------------------------------------------
// 5. PROJECTS DRAWER LOADER
// ----------------------------------------------------
const openProjectDrawer = (projectId) => {
    const spec = projectSpecs[projectId];
    if (!spec) return;
    
    const drawerOverlay = document.getElementById('project-drawer-overlay');
    const drawer = document.getElementById('project-drawer');
    const drawerContent = document.getElementById('project-drawer-content');
    
    if (!drawerOverlay || !drawer || !drawerContent) return;
    
    // Generate drawer body HTML
    let bulletHTML = spec.bullets.map(b => `<li>${b}</li>`).join('');

    // ── Section: GitHub link (independent, shown whenever githubUrl exists)
    const githubSection = spec.githubUrl ? `
        <div class="drawer-section">
            <a href="${spec.githubUrl}" target="_blank" class="drawer-github-btn">
                <i class="fa-brands fa-github"></i>
                View on GitHub
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
            </a>
        </div>
    ` : '';

    // ── Section: Demo — video, live WASM iframe, or WASM coming-soon placeholder
    let demoSection = '';
    if (spec.videoUrl) {
        demoSection = `
        <div class="drawer-section">
            <h3><i class="fa-solid fa-film"></i> Gameplay Demo</h3>
            <div class="drawer-video-wrapper">
                <video class="drawer-video" src="${spec.videoUrl}" controls muted loop preload="metadata" playsinline></video>
            </div>
        </div>`;
    } else if ('wasmUrl' in spec) {
        // wasmUrl key present — either live (string) or coming soon (null)
        if (spec.wasmUrl) {
            demoSection = `
        <div class="drawer-section">
            <h3><i class="fa-solid fa-globe"></i> Interactive Demo <span class="demo-live-badge">LIVE</span></h3>
            <div class="drawer-wasm-wrapper">
                <iframe
                    src="${spec.wasmUrl}"
                    class="drawer-wasm-iframe"
                    title="Usul Engine — Interactive WASM Demo"
                    allow="fullscreen"
                    loading="lazy"
                ></iframe>
                <a href="${spec.wasmUrl}" target="_blank" class="wasm-fullscreen-btn">
                    <i class="fa-solid fa-up-right-and-down-left-from-center"></i> Open Full Screen
                </a>
            </div>
        </div>`;
        } else {
            demoSection = `
        <div class="drawer-section">
            <h3><i class="fa-solid fa-globe"></i> Interactive Demo</h3>
            <div class="drawer-wasm-coming-soon">
                <div class="wasm-icon-ring">
                    <i class="fa-solid fa-microchip"></i>
                </div>
                <div class="wasm-coming-text">
                    <strong>WASM Build — Coming Soon</strong>
                    <p>The Usul Engine editor is being compiled to WebAssembly via Emscripten with a WebGPU backend. Once hosted, you'll be able to run the editor live in your browser here — no install required.</p>
                </div>
                <div class="wasm-tech-pills">
                    <span class="pill">Emscripten</span>
                    <span class="pill">WebGPU</span>
                    <span class="pill">WASM</span>
                    <span class="pill">C++20</span>
                </div>
            </div>
        </div>`;
        }
    }

    // ── Section: Code snippet (independent, shown whenever codeSnippet exists)
    const codeSection = spec.codeSnippet ? `
        <div class="drawer-section">
            <h3><i class="fa-solid fa-terminal"></i> Technical Source Preview</h3>
            <div class="code-window">
                <div class="code-header">
                    <span>${spec.codeHeader}</span>
                    <span class="lang">${spec.codeLang.toUpperCase()}</span>
                </div>
                <pre><code class="language-${spec.codeLang}">${escapeHtml(spec.codeSnippet)}</code></pre>
            </div>
        </div>
    ` : '';

    drawerContent.innerHTML = `
        <h2>${spec.title}</h2>
        <div class="drawer-subtitle">${spec.subtitle}</div>

        ${githubSection}
        
        <div class="drawer-section">
            <h3><i class="fa-solid fa-info-circle"></i> Project Summary</h3>
            <p>${spec.summary}</p>
        </div>
        
        <div class="drawer-section">
            <h3><i class="fa-solid fa-list-check"></i> Key Architectures</h3>
            <ul>
                ${bulletHTML}
            </ul>
        </div>

        ${demoSection}
        ${codeSection}
    `;
    
    // Enable syntax highlighting inside drawer
    if (window.Prism) {
        Prism.highlightAllUnder(drawerContent);
    }
    
    // Open drawer classes
    drawerOverlay.classList.add('open');
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden'; // Stop background scrolling
    
    // Close drawer on overlay click
    drawerOverlay.onclick = closeProjectDrawer;
};

const closeProjectDrawer = () => {
    const drawerOverlay = document.getElementById('project-drawer-overlay');
    const drawer = document.getElementById('project-drawer');
    
    if (drawerOverlay && drawer) {
        drawerOverlay.classList.remove('open');
        drawer.classList.remove('open');
        document.body.style.overflow = 'auto'; // Re-enable scrolling
    }
};

const escapeHtml = (text) => {
    return text
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
};

// ----------------------------------------------------
// 6. BLOG / WRITE-UPS SYSTEM (Markdown + Marked.js)
// ----------------------------------------------------
let blogPosts = [];

const loadBlogSystem = async () => {
    const container = document.getElementById('blog-posts-container');
    if (!container) return;
    
    try {
        // Fetch posts list metadata with cache-busting timestamp
        const response = await fetch('posts.json?t=' + Date.now());
        if (!response.ok) throw new Error('Could not load posts.json index.');
        
        blogPosts = await response.json();
        renderBlogList(blogPosts);
        setupSearchAndFilters();
    } catch (err) {
        console.error(err);
        container.innerHTML = `
            <div class="loading-state">
                <i class="fa-solid fa-circle-exclamation text-orange"></i> Failed to load write-ups index file.
            </div>
        `;
    }
};

const renderBlogList = (posts) => {
    const container = document.getElementById('blog-posts-container');
    if (!container) return;
    
    if (posts.length === 0) {
        container.innerHTML = `
            <div class="loading-state">
                No matching write-ups found for the query or filter tag.
            </div>
        `;
        return;
    }
    
    let html = '';
    posts.forEach(post => {
        let tagPills = post.tags.map(t => `<span class="pill">${t}</span>`).join(' ');
        
        html += `
            <div class="blog-card" onclick="openBlogReader('${post.id}')">
                <div>
                    <div class="blog-card-meta">
                        <span><i class="fa-regular fa-calendar"></i> ${post.date}</span>
                        <span><i class="fa-regular fa-clock"></i> ${post.readTime}</span>
                    </div>
                    <h3>${post.title}</h3>
                    <p>${post.description}</p>
                </div>
                <div class="tech-pills">
                    ${tagPills}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
};

const setupSearchAndFilters = () => {
    const searchInput = document.getElementById('blog-search');
    const filterButtons = document.querySelectorAll('.tag-filter-btn');
    
    let activeTag = 'all';
    let searchQuery = '';
    
    const filterAndRender = () => {
        let filtered = blogPosts;
        
        // Filter by Tag
        if (activeTag !== 'all') {
            filtered = filtered.filter(p => p.tags.includes(activeTag));
        }
        
        // Filter by Search Query
        if (searchQuery !== '') {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(p => 
                p.title.toLowerCase().includes(query) || 
                p.description.toLowerCase().includes(query) || 
                p.tags.some(t => t.toLowerCase().includes(query))
            );
        }
        
        renderBlogList(filtered);
    };
    
    // Search Listener
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            filterAndRender();
        });
    }
    
    // Tag Filters Listener
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTag = btn.getAttribute('data-tag');
            filterAndRender();
        });
    });
};

const openBlogReader = async (postId) => {
    const post = blogPosts.find(p => p.id === postId);
    if (!post) return;
    
    const modal = document.getElementById('blog-reader-modal');
    const content = document.getElementById('blog-reader-content');
    const progressBar = document.getElementById('reader-progress');
    const container = document.querySelector('.reader-container');
    
    if (!modal || !content || !progressBar || !container) return;
    
    content.innerHTML = `
        <div class="loading-state">
            <i class="fa-solid fa-circle-notch fa-spin"></i> Compiling and fetching markdown contents...
        </div>
    `;
    
    // Open Modal — push a history entry so the back button can close it
    history.pushState({ readerOpen: true, postId }, '', `#article-${postId}`);
    modal.classList.add('open');
    document.body.classList.add('reader-open');
    document.body.style.overflow = 'hidden';
    
    // Reset scroll progress bar
    progressBar.style.width = '0%';
    container.scrollTop = 0;
    
    // Hook up scroll listener for reader progress
    container.onscroll = () => {
        let winScroll = container.scrollTop;
        let height = container.scrollHeight - container.clientHeight;
        let scrolled = (height > 0) ? (winScroll / height) * 100 : 0;
        progressBar.style.width = scrolled + "%";
    };
    
    try {
        const response = await fetch(post.filePath + '?t=' + Date.now());
        if (!response.ok) throw new Error('Could not fetch raw markdown file.');
        
        let markdown = await response.text();
        
        // Parse markdown via Marked.js
        let parsedHTML = marked.parse(markdown);
        
        // Translate custom alerts (e.g. > [!NOTE] or > [!IMPORTANT]) into nice HTML alerts
        parsedHTML = postProcessAlerts(parsedHTML);
        
        // Set HTML content
        content.innerHTML = parsedHTML;
        
        // Trigger syntax highlighting
        if (window.Prism) {
            Prism.highlightAllUnder(content);
        }
    } catch (err) {
        console.error(err);
        content.innerHTML = `
            <h2>${post.title}</h2>
            <div class="blog-card-meta">
                <span>${post.date}</span> | <span>${post.readTime}</span>
            </div>
            <div class="loading-state" style="color:var(--accent-orange)">
                <i class="fa-solid fa-triangle-exclamation"></i> Error loading the write-up body: ${err.message}
            </div>
        `;
    }
};

const closeBlogReader = (fromPopState = false) => {
    const modal = document.getElementById('blog-reader-modal');
    if (modal && modal.classList.contains('open')) {
        modal.classList.remove('open');
        document.body.classList.remove('reader-open');
        document.body.style.overflow = 'auto';
        // If the user clicked the close button (not a back-button pop),
        // go back in history to match the state we pushed on open.
        if (!fromPopState) {
            history.back();
        }
    }
};

// Process markdown alerts (e.g. converting > [!NOTE] blockquotes to blockquote.alert-note)
const postProcessAlerts = (html) => {
    const alertTypes = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
    
    alertTypes.forEach(type => {
        const pattern = new RegExp(`<blockquote>\\s*<p>\\s*\\[!${type}\\]`, 'g');
        const replacement = `<blockquote class="alert-${type.toLowerCase()}"><p><strong>${type}</strong><br>`;
        html = html.replace(pattern, replacement);
    });
    
    return html;
};

// ----------------------------------------------------
// 7. BOOTSTRAP INITIALIZATION
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initial Mesh background canvas
    initMeshBackground();
    
    // 2. Setup SPA Routing Hash
    initNavEvents();
    handleHashRouting();

    // 3. Intercept browser back button while the reader modal is open
    window.addEventListener('popstate', (e) => {
        const modal = document.getElementById('blog-reader-modal');
        if (modal && modal.classList.contains('open')) {
            // Back was pressed while reading — close the modal, stay on the page
            closeBlogReader(true);
        }
    });
    
    // 3. Load Blog
    loadBlogSystem();
});
