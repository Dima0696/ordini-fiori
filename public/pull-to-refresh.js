// Pull to Refresh - Instagram Style
class PullToRefresh {
  constructor(pageElement, onRefresh) {
    this.page = pageElement;
    this.onRefresh = onRefresh;
    this.indicator = null;
    this.startY = 0;
    this.currentY = 0;
    this.isDragging = false;
    this.isRefreshing = false;
    this.threshold = 80; // Threshold per triggerare il refresh
    
    this.init();
  }
  
  init() {
    // Trova l'indicator per questa pagina
    const pageId = this.page.id;
    this.indicator = document.getElementById(`pull-refresh-indicator-${pageId.replace('page-', '')}`);
    
    if (!this.indicator) return;
    
    // Touch events
    this.page.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
    this.page.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    this.page.addEventListener('touchend', this.handleTouchEnd.bind(this));
    
    // Mouse events per test su desktop
    this.page.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.page.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.page.addEventListener('mouseup', this.handleMouseUp.bind(this));
  }
  
  handleTouchStart(e) {
    // Solo se siamo in cima alla pagina
    if (this.page.scrollTop === 0 && !this.isRefreshing) {
      this.startY = e.touches[0].pageY;
      this.isDragging = false;
    }
  }
  
  handleTouchMove(e) {
    if (this.startY === 0 || this.isRefreshing) return;
    
    this.currentY = e.touches[0].pageY;
    const diff = this.currentY - this.startY;
    
    // Pull verso il basso e siamo in cima
    if (diff > 0 && this.page.scrollTop === 0) {
      e.preventDefault(); // Previeni lo scroll
      this.isDragging = true;
      
      // Calcola progresso (0-1)
      const progress = Math.min(diff / this.threshold, 1.5);
      
      // Mostra indicator
      if (progress > 0.3) {
        this.indicator.classList.add('visible');
      }
      
      // Transform della pagina (effetto elastic)
      const translateY = diff * 0.4; // Rallenta il movimento
      this.page.style.transform = `translateY(${translateY}px)`;
      this.page.style.transition = 'none';
      
      document.body.classList.add('pulling');
    }
  }
  
  handleTouchEnd(e) {
    if (!this.isDragging || this.isRefreshing) return;
    
    const diff = this.currentY - this.startY;
    
    // Reset transform
    this.page.style.transform = '';
    this.page.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    document.body.classList.remove('pulling');
    
    // Se abbiamo superato la threshold, refresh!
    if (diff > this.threshold) {
      this.triggerRefresh();
    } else {
      // Nascondi indicator
      this.indicator.classList.remove('visible');
    }
    
    this.startY = 0;
    this.currentY = 0;
    this.isDragging = false;
  }
  
  // Mouse events per desktop testing
  handleMouseDown(e) {
    if (this.page.scrollTop === 0 && !this.isRefreshing) {
      this.startY = e.pageY;
      this.isDragging = false;
    }
  }
  
  handleMouseMove(e) {
    if (this.startY === 0 || this.isRefreshing) return;
    
    this.currentY = e.pageY;
    const diff = this.currentY - this.startY;
    
    if (diff > 0 && this.page.scrollTop === 0) {
      e.preventDefault();
      this.isDragging = true;
      
      const progress = Math.min(diff / this.threshold, 1.5);
      
      if (progress > 0.3) {
        this.indicator.classList.add('visible');
      }
      
      const translateY = diff * 0.4;
      this.page.style.transform = `translateY(${translateY}px)`;
      this.page.style.transition = 'none';
      
      document.body.classList.add('pulling');
    }
  }
  
  handleMouseUp(e) {
    if (!this.isDragging || this.isRefreshing) return;
    
    const diff = this.currentY - this.startY;
    
    this.page.style.transform = '';
    this.page.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    document.body.classList.remove('pulling');
    
    if (diff > this.threshold) {
      this.triggerRefresh();
    } else {
      this.indicator.classList.remove('visible');
    }
    
    this.startY = 0;
    this.currentY = 0;
    this.isDragging = false;
  }
  
  async triggerRefresh() {
    if (this.isRefreshing) return;
    
    this.isRefreshing = true;
    this.indicator.classList.add('visible');
    
    try {
      // Esegui la funzione di refresh
      await this.onRefresh();
      
      // Piccolo delay per feedback
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Errore refresh:', error);
    } finally {
      // Nascondi indicator
      this.indicator.classList.remove('visible');
      this.isRefreshing = false;
    }
  }
  
  // Metodo pubblico per triggerare refresh programmatically
  async refresh() {
    await this.triggerRefresh();
  }
}

// Export per uso in app.js
window.PullToRefresh = PullToRefresh;

