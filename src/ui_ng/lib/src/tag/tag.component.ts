// Copyright (c) 2017 VMware, Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import {
  Component,
  OnInit,
  ViewChild,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ElementRef, AfterContentInit, AfterViewInit
} from "@angular/core";

import { TagService, VulnerabilitySeverity, RequestQueryParams } from "../service/index";
import { ErrorHandler } from "../error-handler/error-handler";
import { ChannelService } from "../channel/index";
import {
  ConfirmationTargets,
  ConfirmationState,
  ConfirmationButtons
} from "../shared/shared.const";

import { ConfirmationDialogComponent } from "../confirmation-dialog/confirmation-dialog.component";
import { ConfirmationMessage } from "../confirmation-dialog/confirmation-message";
import { ConfirmationAcknowledgement } from "../confirmation-dialog/confirmation-state-message";

import {Label, Tag, TagClickEvent} from "../service/interface";

import { TAG_TEMPLATE } from "./tag.component.html";
import { TAG_STYLE } from "./tag.component.css";

import {
  toPromise,
  CustomComparator,
  calculatePage,
  doFiltering,
  doSorting,
  VULNERABILITY_SCAN_STATUS,
  DEFAULT_PAGE_SIZE,
  clone,
} from "../utils";

import { TranslateService } from "@ngx-translate/core";

import { State, Comparator } from "clarity-angular";
import {CopyInputComponent} from "../push-image/copy-input.component";
import {BatchInfo, BathInfoChanges} from "../confirmation-dialog/confirmation-batch-message";
import {Observable} from "rxjs/Observable";
import {LabelService} from "../service/label.service";
import {Subject} from "rxjs/Subject";

@Component({
  selector: "hbr-tag",
  template: TAG_TEMPLATE,
  styles: [TAG_STYLE],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TagComponent implements OnInit, AfterViewInit {

  signedCon: {[key: string]: any | string[]} = {};
  @Input() projectId: number;
  @Input() repoName: string;
  @Input() isEmbedded: boolean;

  @Input() hasSignedIn: boolean;
  @Input() hasProjectAdminRole: boolean;
  @Input() isGuest: boolean;
  @Input() registryUrl: string;
  @Input() withNotary: boolean;
  @Input() withClair: boolean;
  @Input() withAdmiral: boolean;
  @Output() refreshRepo = new EventEmitter<boolean>();
  @Output() tagClickEvent = new EventEmitter<TagClickEvent>();
  @Output() signatureOutput = new EventEmitter<any>();


  tags: Tag[];

  showTagManifestOpened: boolean;
  manifestInfoTitle: string;
  digestId: string;
  staticBackdrop = true;
  closable = false;
  lastFilteredTagName: string;
  batchDelectionInfos: BatchInfo[] = [];

  createdComparator: Comparator<Tag> = new CustomComparator<Tag>("created", "date");

  loading = false;
  copyFailed = false;
  selectedRow: Tag[] = [];

  imageLabels: {[key: string]: boolean | Label | any}[] = [];
  imageStickLabels: {[key: string]: boolean | Label | any}[] = [];
  imageFilterLabels: {[key: string]: boolean | Label | any}[] = [];

  labelListOpen = false;
  selectedTag: Tag[];
  labelNameFilter: Subject<string> = new Subject<string> ();
  stickLabelNameFilter: Subject<string> = new Subject<string> ();
  filterOnGoing: boolean;

  initFilter = {
    name: '',
    description: '',
    color: '',
    scope: '',
    project_id: 0,
  }
  filterOneLabel: Label = this.initFilter;


  @ViewChild('confirmationDialog')
  confirmationDialog: ConfirmationDialogComponent;

  @ViewChild("digestTarget") textInput: ElementRef;
  @ViewChild("copyInput") copyInput: CopyInputComponent;

  pageSize: number = DEFAULT_PAGE_SIZE;
  currentPage = 1;
  totalCount = 0;
  currentState: State;

  constructor(
    private errorHandler: ErrorHandler,
    private tagService: TagService,
    private labelService: LabelService,
    private translateService: TranslateService,
    private ref: ChangeDetectorRef,
    private channel: ChannelService
  ) { }

  ngOnInit() {
    if (!this.projectId) {
      this.errorHandler.error("Project ID cannot be unset.");
      return;
    }
    if (!this.repoName) {
      this.errorHandler.error("Repo name cannot be unset.");
      return;
    }

    this.retrieve();
    this.lastFilteredTagName = '';

    this.labelNameFilter
        .debounceTime(500)
        .distinctUntilChanged()
        .subscribe((name: string) => {
          if (name && name.length) {
            this.filterOnGoing = true;
            this.imageFilterLabels = [];

            this.imageLabels.forEach(data => {
              if (data.label.name.indexOf(name) !== -1) {
                this.imageFilterLabels.push(data);
              }
            })
            setTimeout(() => {
              setInterval(() => this.ref.markForCheck(), 200);
            }, 1000);
          }
        });

    this.stickLabelNameFilter
        .debounceTime(500)
        .distinctUntilChanged()
        .subscribe((name: string) => {
          if (name && name.length) {
            this.filterOnGoing = true;
            this.imageStickLabels = [];

            this.imageLabels.forEach(data => {
              if (data.label.name.indexOf(name) !== -1) {
                this.imageStickLabels.push(data);
              }
            })
            setTimeout(() => {
              setInterval(() => this.ref.markForCheck(), 200);
            }, 1000);
          }
        });

  }

  ngAfterViewInit() {
    if (!this.withAdmiral) {
      this.getAllLabels();
    }
  }

  public get filterLabelPieceWidth() {
    let len = this.lastFilteredTagName.length ? this.lastFilteredTagName.length * 6 + 60 : 115;
    return len > 210 ? 210 : len;
}

  doSearchTagNames(tagName: string) {
    this.lastFilteredTagName = tagName;
    this.currentPage = 1;

    let st: State = this.currentState;
    if (!st) {
      st = { page: {} };
    }
    st.page.size = this.pageSize;
    st.page.from = 0;
    st.page.to = this.pageSize - 1;
    st.filters = [{property: "name", value: this.lastFilteredTagName}];
    this.clrLoad(st);
  }

  clrLoad(state: State): void {
    this.selectedRow = [];
    // Keep it for future filtering and sorting
    this.currentState = state;

    let pageNumber: number = calculatePage(state);
    if (pageNumber <= 0) { pageNumber = 1; }

    // Pagination
    let params: RequestQueryParams = new RequestQueryParams();
    params.set("page", "" + pageNumber);
    params.set("page_size", "" + this.pageSize);

    this.loading = true;

    toPromise<Tag[]>(this.tagService.getTags(
      this.repoName,
      params))
      .then((tags: Tag[]) => {
        this.signedCon = {};
        // Do filtering and sorting
        this.tags = doFiltering<Tag>(tags, state);
        this.tags = doSorting<Tag>(this.tags, state);

        this.loading = false;
      })
      .catch(error => {
        this.loading = false;
        this.errorHandler.error(error);
      });

    // Force refresh view
    let hnd = setInterval(() => this.ref.markForCheck(), 100);
    setTimeout(() => clearInterval(hnd), 5000);
  }

  refresh() {
    this.doSearchTagNames("");
  }

  getAllLabels(): void {
    toPromise<Label[]>(this.labelService.getGLabels()).then((res: Label[]) => {
      if (res.length) {
        res.forEach(data => {
          this.imageLabels.push({'iconsShow': false, 'label': data});
        });
      }

      toPromise<Label[]>(this.labelService.getPLabels(this.projectId)).then((res1: Label[]) => {
        if (res1.length) {
          res1.forEach(data => {
            this.imageLabels.push({'iconsShow': false, 'label': data});
          });
        }
        this.imageFilterLabels = clone(this.imageLabels);
        this.imageStickLabels = clone(this.imageLabels);
      }).catch(error => {
        this.errorHandler.error(error);
      });
    }).catch(error => {
      this.errorHandler.error(error);
    });
  }

  selectedChange(tag?: Tag[]): void {
    if (tag && tag[0].labels && tag[0].labels.length) {
      tag[0].labels.forEach((labelInfo: Label) => {
        this.imageStickLabels.forEach(data => {
          if (labelInfo.id === data['label'].id) {
            data.iconsShow = true;
          }
        });
      });
    }
  }

  addLabels(tag: Tag[]): void {
    this.labelListOpen = true;
    this.selectedTag = tag;

    this.selectedChange(tag);
  }
  selectLabel(labelInfo: {[key: string]: any | string[]}): void {
    if (labelInfo && !labelInfo.iconsShow) {
      let labelId = labelInfo.label.id;
      this.selectedRow = this.selectedTag;
      toPromise<any>(this.tagService.addLabelToImages(this.repoName, this.selectedRow[0].name, labelId)).then(res => {
        this.refresh();
      }).catch(err => {
        this.errorHandler.error(err);
      });
    }
  }

  unSelectLabel(labelInfo: {[key: string]: any | string[]}): void {
    if (labelInfo && labelInfo.iconsShow) {
      let labelId = labelInfo.label.id;
      this.selectedRow = this.selectedTag;
      toPromise<any>(this.tagService.deleteLabelToImages(this.repoName, this.selectedRow[0].name, labelId)).then(res => {
        this.refresh();
      }).catch(err => {
        this.errorHandler.error(err);
      });
    }
  }

  filterLabel(labelInfo: {[key: string]: any | string[]}): void {
    if (labelInfo && labelInfo.iconsShow) {
      let labelName = labelInfo.label.name;
      this.imageFilterLabels.filter(data => {
        if (data.label.name !== labelName) {
          data.iconsShow = false;
        }
      });

     this.filterOneLabel = labelInfo.label;

      // reload datagu
      this.currentPage = 1;
      let st: State = this.currentState;
      if (!st) {
        st = { page: {} };
      }
      st.page.size = this.pageSize;
      st.page.from = 0;
      st.page.to = this.pageSize - 1;
      if (this.lastFilteredTagName) {
        st.filters = [{property: 'name', value: this.lastFilteredTagName}, {property: 'labels.name', value: labelName}];
      }else {
        st.filters = [{property: 'labels.name', value: labelName}];
      }

      this.clrLoad(st);
    }
  }

  unFilterLabel(labelInfo: {[key: string]: any | string[]}): void {
    if (labelInfo && !labelInfo.iconsShow) {
      this.filterOneLabel = this.initFilter;

      // reload datagu
      this.currentPage = 1;
      let st: State = this.currentState;
      if (!st) {
        st = { page: {} };
      }
      st.page.size = this.pageSize;
      st.page.from = 0;
      st.page.to = this.pageSize - 1;
      if (this.lastFilteredTagName) {
        st.filters = [{property: 'name', value: this.lastFilteredTagName}];
      }else {
        st.filters = [];
      }
      this.clrLoad(st);
    }
  }

  handleInputFilter($event: string) {
    if ($event && $event.length) {
      this.labelNameFilter.next($event);
    }else {
      this.imageFilterLabels = clone(this.imageLabels);
    }
  }

  handleStickInputFilter($event: string) {
    if ($event && $event.length) {
      this.stickLabelNameFilter.next($event);
    }else {
      this.imageStickLabels = clone(this.imageLabels);
    }
  }

  retrieve() {
    this.tags = [];
    let signatures: string[] = [] ;
    this.loading = true;

    toPromise<Tag[]>(this.tagService
      .getTags(this.repoName))
      .then(items => {
        // To keep easy use for vulnerability bar
        items.forEach((t: Tag) => {
          if (!t.scan_overview) {
            t.scan_overview = {
              scan_status: VULNERABILITY_SCAN_STATUS.stopped,
              severity: VulnerabilitySeverity.UNKNOWN,
              update_time: new Date(),
              components: {
                total: 0,
                summary: []
            }
        };
      }
      if (t.signature !== null) {
        signatures.push(t.name);
      }
      });
      this.tags = items;
        let signedName: {[key: string]: string[]} = {};
        signedName[this.repoName] = signatures;
        this.signatureOutput.emit(signedName);
        this.loading = false;
        if (this.tags && this.tags.length === 0) {
          this.refreshRepo.emit(true);
        }
      })
      .catch(error => {
        this.errorHandler.error(error);
        this.loading = false;
      });
    let hnd = setInterval(() => this.ref.markForCheck(), 100);
    setTimeout(() => clearInterval(hnd), 5000);
  }

  sizeTransform(tagSize: string): string {
    let size: number = Number.parseInt(tagSize);
    if (Math.pow(1024, 1) <= size && size < Math.pow(1024, 2)) {
      return (size / Math.pow(1024, 1)).toFixed(2) + "KB";
    } else if (Math.pow(1024, 2) <= size && size < Math.pow(1024, 3)) {
      return  (size / Math.pow(1024, 2)).toFixed(2) + "MB";
    } else if (Math.pow(1024, 3) <= size && size < Math.pow(1024, 4)) {
      return  (size / Math.pow(1024, 3)).toFixed(2) + "GB";
    } else {
      return size + "B";
    }
  }

  deleteTags(tags: Tag[]) {
    if (tags && tags.length) {
      let tagNames: string[] = [];
      this.batchDelectionInfos = [];
      tags.forEach(tag => {
        tagNames.push(tag.name);
        let initBatchMessage = new BatchInfo ();
        initBatchMessage.name = tag.name;
        this.batchDelectionInfos.push(initBatchMessage);
      });

      let titleKey: string, summaryKey: string, content: string, buttons: ConfirmationButtons;
      titleKey = "REPOSITORY.DELETION_TITLE_TAG";
      summaryKey = "REPOSITORY.DELETION_SUMMARY_TAG";
      buttons = ConfirmationButtons.DELETE_CANCEL;
      content = tagNames.join(" , ");
      let message = new ConfirmationMessage(
        titleKey,
        summaryKey,
        content,
        tags,
        ConfirmationTargets.TAG,
        buttons);
      this.confirmationDialog.open(message);
    }
  }

  confirmDeletion(message: ConfirmationAcknowledgement) {
    if (message &&
        message.source === ConfirmationTargets.TAG
        && message.state === ConfirmationState.CONFIRMED) {
      let tags: Tag[] = message.data;
      if (tags && tags.length) {
        let promiseLists: any[] = [];
        tags.forEach(tag => {
          promiseLists.push(this.delOperate(tag.signature, tag.name));
        });

        Promise.all(promiseLists).then((item) => {
          this.selectedRow = [];
          this.retrieve();
        });
      }
    }
  }

  delOperate(signature: any, name:  string) {
    let findedList = this.batchDelectionInfos.find(data => data.name === name);
    if (signature) {
      Observable.forkJoin(this.translateService.get("BATCH.DELETED_FAILURE"),
        this.translateService.get("REPOSITORY.DELETION_SUMMARY_TAG_DENIED")).subscribe(res => {
        let wrongInfo: string = res[1] + "notary -s https://" + this.registryUrl + ":4443 -d ~/.docker/trust remove -p " + this.registryUrl + "/" + this.repoName + " " + name;
        findedList = BathInfoChanges(findedList, res[0], false, true, wrongInfo);
      });
    } else {
      return toPromise<number>(this.tagService
          .deleteTag(this.repoName, name))
          .then(
              response => {
                this.translateService.get("BATCH.DELETED_SUCCESS")
                    .subscribe(res =>  {
                      findedList = BathInfoChanges(findedList, res);
                    });
              }).catch(error => {
            this.translateService.get("BATCH.DELETED_FAILURE").subscribe(res => {
              findedList = BathInfoChanges(findedList, res, false, true);
            });
          });
    }
  }

  showDigestId(tag: Tag[]) {
    if (tag && (tag.length === 1)) {
      this.manifestInfoTitle = "REPOSITORY.COPY_DIGEST_ID";
      this.digestId = tag[0].digest;
      this.showTagManifestOpened = true;
      this.copyFailed = false;
    }
  }

  onTagClick(tag: Tag): void {
    if (tag) {
      let evt: TagClickEvent = {
        project_id: this.projectId,
        repository_name: this.repoName,
        tag_name: tag.name
      };
      this.tagClickEvent.emit(evt);
    }
  }

  onSuccess($event: any): void {
    this.copyFailed = false;
    // Directly close dialog
    this.showTagManifestOpened = false;
  }

  onError($event: any): void {
    // Show error
    this.copyFailed = true;
    // Select all text
    if (this.textInput) {
      this.textInput.nativeElement.select();
    }
  }

  // Get vulnerability scanning status
  scanStatus(t: Tag): string {
    if (t && t.scan_overview && t.scan_overview.scan_status) {
      return t.scan_overview.scan_status;
    }

    return VULNERABILITY_SCAN_STATUS.unknown;
  }

  existObservablePackage(t: Tag): boolean {
    return t.scan_overview &&
      t.scan_overview.components &&
      t.scan_overview.components.total &&
      t.scan_overview.components.total > 0 ? true : false;
  }

  // Whether show the 'scan now' menu
  canScanNow(t: Tag[]): boolean {
    if (!this.withClair) { return false; }
    if (!this.hasProjectAdminRole) { return false; }
      let st: string = this.scanStatus(t[0]);

    return st !== VULNERABILITY_SCAN_STATUS.pending &&
      st !== VULNERABILITY_SCAN_STATUS.running;
  }

  // Trigger scan
  scanNow(t: Tag[]): void {
    if (t && t.length) {
      t.forEach((data: any) => {
        let tagId = data.name;
        this.channel.publishScanEvent(this.repoName + "/" + tagId);
      });
    }
  }

  // pull command
  onCpError($event: any): void {
      this.copyInput.setPullCommendShow();
  }
}
