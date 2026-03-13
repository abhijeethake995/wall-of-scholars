// public/js/main.js

const token = localStorage.getItem('token');
const userRole = localStorage.getItem('role');


// Add a Toast Container to the body automatically
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

window.showToast = function(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    
    toastContainer.appendChild(toast);
    
    // Slide it in
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove it after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300); // Wait for slide out animation
    }, 3000);
}

// --- Global Logout ---
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.clear();
        window.location.href = '/pages/login.html';
    });
}

// --- 1. Home Page: Load Cards, Filter & Modal Logic ---
const wallContainer = document.getElementById('wall-container');
let allAchievements = []; // Master list

if (wallContainer) {
    // DOM Elements for filtering
    const searchInput = document.getElementById('searchInput');
    const filterDept = document.getElementById('filterDepartment');
    const filterCat = document.getElementById('filterCategory');

    async function fetchAchievements() {
        try {
            const response = await fetch('/api/achievements/public');
            allAchievements = await response.json();
            renderWall(allAchievements); // Initial render with all data
        } catch (error) {
            console.error('Error:', error);
            wallContainer.innerHTML = '<p style="color:red;">Failed to load achievements.</p>';
        }
    }

    // Function to draw the cards based on an array of data
    function renderWall(dataToRender) {
        wallContainer.innerHTML = ''; 

        if (dataToRender.length === 0) {
            wallContainer.innerHTML = '<p>No achievements found matching your criteria.</p>';
            return;
        }

        dataToRender.forEach((ach) => {
            // Find the original index so the modal still works!
            const originalIndex = allAchievements.findIndex(a => a.id === ach.id);
            
            const card = document.createElement('div');
            card.className = 'card';
            card.setAttribute('onclick', `openModal(${originalIndex})`);
            
            const photoSrc = ach.student_photo || '/images/default-avatar.png';

            card.innerHTML = `
                <img src="${photoSrc}" class="card-img" alt="${ach.student_name}">
                <div class="card-content">
                    <h3 class="card-title">${ach.title}</h3>
                    <div class="card-meta">${ach.category} | ${ach.department}</div>
                    <p style="font-size: 0.9rem; color: #4b5563;">${ach.student_name}</p>
                </div>
            `;
            wallContainer.appendChild(card);
        });
    }

    // The Filtering Logic
    function applyFilters() {
        const searchTerm = searchInput.value.toLowerCase();
        const deptTerm = filterDept.value;
        const catTerm = filterCat.value;

        const filteredData = allAchievements.filter(ach => {
            // Check Search (Name or Title)
            const matchesSearch = ach.student_name.toLowerCase().includes(searchTerm) || 
                                  ach.title.toLowerCase().includes(searchTerm);
            
            // Check Department Dropdown
            const matchesDept = deptTerm === 'All' || ach.department === deptTerm;
            
            // Check Category Dropdown
            const matchesCat = catTerm === 'All' || ach.category === catTerm;

            return matchesSearch && matchesDept && matchesCat;
        });

        renderWall(filteredData);
    }

    // Add event listeners so it filters instantly when the user types or clicks
    searchInput.addEventListener('input', applyFilters);
    filterDept.addEventListener('change', applyFilters);
    filterCat.addEventListener('change', applyFilters);

    // Kick it off!
    fetchAchievements();
}
// Modal Functions (Must be attached to window to work with inline onclick)
window.openModal = function(index) {
    const data = allAchievements[index];
    document.getElementById('modal-name').innerText = data.student_name;
    document.getElementById('modal-dept').innerText = data.department;
    document.getElementById('modal-category').innerText = data.category;
    document.getElementById('modal-title').innerText = data.title;
    document.getElementById('modal-desc').innerText = data.description;
    
    document.getElementById('modal-photo').src = data.student_photo || '/images/default-avatar.png';
    
    const proofBtn = document.getElementById('modal-proof');
    if (data.document_path) {
        proofBtn.href = data.document_path;
        proofBtn.style.display = 'inline-block';
    } else {
        proofBtn.style.display = 'none';
    }

    document.getElementById('achievementModal').style.display = 'flex';
}

window.closeModal = function() {
    document.getElementById('achievementModal').style.display = 'none';
}

// Close modal if user clicks outside of it
window.onclick = function(event) {
    const modal = document.getElementById('achievementModal');
    if (event.target == modal) {
        modal.style.display = "none";
    }
}


// --- 2. Submit Achievement (Handling 2 Files) ---
const submitForm = document.getElementById('submitForm');
if (submitForm) {
    submitForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData();
        formData.append('student_name', document.getElementById('student_name').value);
        formData.append('department', document.getElementById('department').value);
        formData.append('category', document.getElementById('category').value);
        formData.append('title', document.getElementById('title').value);
        formData.append('description', document.getElementById('description').value);
        
        // Append both files
        const photoFile = document.getElementById('photo').files[0];
        const docFile = document.getElementById('document').files[0];
        if (photoFile) formData.append('photo', photoFile);
        if (docFile) formData.append('document', docFile);

        try {
            const response = await fetch('/api/achievements', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData // Fetch automatically handles multipart/form-data headers
            });
            
            if (response.ok) {
                alert('Achievement submitted for review!');
                window.location.href = '../index.html';
            } else {
                alert('Submission failed.');
            }
        } catch (error) {
            console.error('Error:', error);
        }
    });
}

// --- 3. Admin Dashboard ---
const pendingTableBody = document.getElementById('pending-table-body');
if (pendingTableBody) {
    async function loadPendingRequests() {
        try {
            const response = await fetch('/api/admin/pending', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const pending = await response.json();
            pendingTableBody.innerHTML = '';
            
            pending.forEach(req => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${req.student_name}</strong><br><small>${req.department}</small></td>
                    <td><strong>${req.title}</strong><br><small>${req.category}</small></td>
                    <td>
                        <a href="${req.student_photo}" target="_blank">Photo</a> | 
                        <a href="${req.document_path}" target="_blank">Proof</a>
                    </td>
                    <td>
                        <button class="btn-sm bg-green" onclick="verifyAchievement(${req.id}, 'Verified')">Approve</button>
                        <button class="btn-sm bg-red" onclick="verifyAchievement(${req.id}, 'Rejected')">Reject</button>
                    </td>
                `;
                pendingTableBody.appendChild(tr);
            });
        } catch (error) {
            console.error('Error:', error);
        }
    }
    loadPendingRequests();
}

window.verifyAchievement = async function(id, status) {
    if (!confirm(`Mark as ${status}?`)) return;
    try {
        const response = await fetch(`/api/admin/verify/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ status })
        });
        if (response.ok) location.reload();
    } catch (error) {
        console.error('Error:', error);
    }
};