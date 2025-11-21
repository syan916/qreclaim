// Login page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('login-form');
    const userIdInput = document.getElementById('user-id');
    const passwordInput = document.getElementById('password');
    const errorMessage = document.querySelector('.error-message');
    const loginTypeIndicator = document.getElementById('login-type-indicator');
    const togglePasswordBtn = document.getElementById('toggle-password');
    const loginBtn = document.querySelector('.login-btn');

    // Clear error message when page loads
    if (errorMessage) {
        errorMessage.textContent = '';
    }
    
    // Function to validate form and update button state
    function validateForm() {
        if (!loginBtn || !userIdInput || !passwordInput) return false;
        
        const userId = userIdInput.value.trim();
        const password = passwordInput.value.trim();
        
        // Only check if fields are not empty
        const isValid = userId !== '' && password !== '';
        
        // Update button state
        if (isValid) {
            loginBtn.disabled = false;
            loginBtn.classList.remove('disabled');
        } else {
            loginBtn.disabled = true;
            loginBtn.classList.add('disabled');
        }
        
        return isValid;
    }

    // Password visibility toggle
    if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener('click', function () {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);

            // Update icon
            this.innerHTML = type === 'password' ?
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>' :
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';
        });
    }

    // Detect login type based on user ID format
    function detectLoginType(userId) {
        if (!userId) return 'Student/Admin';

        // Admin IDs are typically 4 digits
        if (/^\d{4}$/.test(userId)) {
            return 'Admin';
        }
        // Student IDs are typically 7 digits
        else if (/^\d{7}$/.test(userId)) {
            return 'Student';
        } else {
            return 'Unknown';
        }
    }

    // Update login type indicator when user types
    if (userIdInput) {
        userIdInput.addEventListener('input', function () {
            const userId = this.value.trim();
            const loginType = detectLoginType(userId);
            if (loginTypeIndicator) {
                loginTypeIndicator.textContent = loginType !== 'Unknown' ? `Login Type: ${loginType}` : '';
            }
            
            // Clear error styling
            this.classList.remove('error');
            
            // Clear error message when user starts typing
            if (errorMessage) {
                errorMessage.textContent = '';
            }
            
            validateForm();
        });
    }

    // Password validation with real-time feedback
    if (passwordInput) {
        passwordInput.addEventListener('input', function () {
            // Clear any error styling when user types
            this.classList.remove('error');
            
            // Clear error message when user starts typing
            if (errorMessage) {
                errorMessage.textContent = '';
            }
            
            validateForm();
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', function (e) {
            let isValid = true;

            // Enhanced validation
            if (!userIdInput.value.trim()) {
                isValid = false;
                userIdError.textContent = 'User ID is required';
                userIdInput.classList.add('error');
            } else if (!/^\d{4}$/.test(userIdInput.value.trim()) && !/^\d{7}$/.test(userIdInput.value.trim())) {
                isValid = false;
                userIdError.textContent = 'Enter a valid Student ID (7 digits) or Admin ID (4 digits)';
                userIdInput.classList.add('error');
            } else {
                userIdError.textContent = '';
                userIdInput.classList.remove('error');
            }

            if (!passwordInput.value.trim()) {
                isValid = false;
                passwordError.textContent = 'Password is required';
                passwordInput.classList.add('error');
            } else if (passwordInput.value.length < 6) {
                isValid = false;
                passwordError.textContent = 'Password must be at least 6 characters';
                passwordInput.classList.add('error');
            } else {
                passwordError.textContent = '';
                passwordInput.classList.remove('error');
            }

            if (!isValid) {
                e.preventDefault();
            }
        });
    }

    // Session timeout handling - 5 minutes (300000 ms)
    const SESSION_TIMEOUT = 300000;
    let timeoutId;

    function resetSessionTimer() {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(sessionExpired, SESSION_TIMEOUT);
    }

    function sessionExpired() {
        alert('Your session has expired due to inactivity. Please login again.');
        window.location.href = '/logout';
    }
    // Reset timer on user activity
    ['click', 'keypress', 'scroll', 'mousemove'].forEach(event => {
        document.addEventListener(event, resetSessionTimer);
    });

    // Initialize session timer
    resetSessionTimer();
});


// Helper functions for form validation
function showError(input, message) {
    const formGroup = input.parentElement;
    let errorElement = formGroup.querySelector('.error-message');

    if (!errorElement) {
        errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        errorElement.style.color = '#e74c3c';
        errorElement.style.fontSize = '12px';
        errorElement.style.marginTop = '5px';
        formGroup.appendChild(errorElement);
    }

    errorElement.textContent = message;
    input.style.borderColor = '#e74c3c';
}

function removeError(input) {
    const formGroup = input.parentElement;
    const errorElement = formGroup.querySelector('.error-message');

    if (errorElement) {
        formGroup.removeChild(errorElement);
    }

    input.style.borderColor = '';
}