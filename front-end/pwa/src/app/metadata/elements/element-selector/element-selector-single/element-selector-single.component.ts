import { Component, Input, Output, EventEmitter, SimpleChanges, OnChanges, OnDestroy } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { ElementCacheModel, ElementsCacheService } from '../../services/elements-cache.service';

@Component({
  selector: 'app-element-selector-single',
  templateUrl: './element-selector-single.component.html',
  styleUrls: ['./element-selector-single.component.scss']
})
export class ElementSelectorSingleComponent implements OnChanges, OnDestroy {
  @Input() public id!: string;
  @Input() public label!: string;
  @Input() public displayCancelOption!: boolean
  @Input() public errorMessage!: string;
  @Input() public includeOnlyIds!: number[];
  @Input() public options: ElementCacheModel[] | null = null;
  @Input() public selectedId!: number | null;
  @Output() public selectedIdChange = new EventEmitter<number>();

  protected allElements: ElementCacheModel[] = [];
  protected elements!: ElementCacheModel[];
  protected selectedElement!: ElementCacheModel | null;
  private destroy$ = new Subject<void>();

  constructor(private elementsCacheSevice: ElementsCacheService) {
    this.elementsCacheSevice.cachedElements.pipe(
      takeUntil(this.destroy$),
    ).subscribe(data => {
      this.allElements = data;
      this.setElementsToInclude();
      this.setSelected();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['options'] || changes['includeOnlyIds']) {
      this.setElementsToInclude();
    }
    if (changes['selectedId']) {
      this.setSelected();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setElementsToInclude(): void {
    if (this.options) {
      this.elements = this.options;
    } else if (this.includeOnlyIds && this.includeOnlyIds.length > 0) {
      const includedIds = new Set(this.includeOnlyIds);
      this.elements = this.allElements.filter(item => includedIds.has(item.id));
    } else {
      this.elements = this.allElements;
    }
  }

  private setSelected(): void {
    if (this.selectedId && this.elements) {
      const found = this.elements.find(data => data.id === this.selectedId);
      this.selectedElement = found ? found : null;
    } else {
      this.selectedElement = null;
    }
  }

  protected optionDisplayFunction(option: ElementCacheModel): string {
    return `${option.id} - ${option.abbreviation} - ${option.name}`;
  }

  protected onSelectedOptionChange(selectedOption: ElementCacheModel | null) {
    const selectedId = selectedOption ? selectedOption.id : 0;
    if (selectedId === this.selectedId) {
      return;
    }

    this.selectedId = selectedId;
    this.selectedIdChange.emit(this.selectedId);
  }

  protected trackByElementId(_index: number, option: ElementCacheModel): number {
    return option.id;
  }
}
